"""Real SDK serialization through MockTransport: no Gemini or database network access."""
import json
import sys
import unittest
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
from google import genai
from google.genai import types
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
with patch('dotenv.load_dotenv'):
    import main
from fastapi.testclient import TestClient


class GeminiRequestTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.output = {}
        self.status = 200
        self.addCleanup(patch.stopall)
        patch.dict(main.os.environ, {'GEMINI_API_KEY': 'mock-only-key'}).start()
        patch.object(main, 'gemini_client', side_effect=self.client).start()
        self.db = patch.object(main, 'inventory_connection').start()
        self.db.return_value.__enter__.return_value.execute.return_value.fetchall.return_value = [
            (1, 'spinach', 200, 'g', date.today() + timedelta(days=1), 'estimated', False),
            (2, 'rice', 500, 'g', date.today() + timedelta(days=20), 'printed', True),
        ]
        self.api = TestClient(main.app)

    def client(self, timeout):
        def transport(request):
            self.calls.append(request)
            if self.status != 200:
                return httpx.Response(self.status, json=self.output)
            return httpx.Response(200, json={'candidates': [{'content': {'role': 'model', 'parts': [{'text': json.dumps(self.output)}]}}]})
        return genai.Client(api_key='mock-only-key', http_options=types.HttpOptions(
            httpx_client=httpx.Client(transport=httpx.MockTransport(transport)),
            timeout=timeout, retry_options=types.HttpRetryOptions(attempts=1),
        ))

    def payload(self):
        self.assertEqual(len(self.calls), 1)
        request = self.calls[0]
        self.assertEqual(request.url.host, 'generativelanguage.googleapis.com')
        self.assertEqual(request.url.path, '/v1beta/models/' + main.GEMINI_MODEL + ':generateContent')
        self.assertEqual(request.headers['content-type'], 'application/json')
        self.assertEqual(request.headers['x-goog-api-key'], 'mock-only-key')
        self.assertNotIn('key=', str(request.url))
        return json.loads(request.content)

    def test_recognition_uses_native_schema_with_image_and_expiry_metadata(self):
        value = (date.today() + timedelta(days=2)).isoformat()
        self.output = {'items': [{'name': 'spinach', 'quantity': 1, 'unit': 'pack', 'expiry_date': value, 'expiry_date_source': 'estimated', 'needs_confirmation': True}]}
        image = BytesIO()
        Image.new('RGB', (2, 2)).save(image, format='PNG')
        response = self.api.post('/scan', files={'image': ('fixture.png', image.getvalue(), 'image/png')})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['items'][0]['expiry_date'], value)
        body = self.payload()
        self.assertIn('responseSchema', body['generationConfig'])
        self.assertNotIn('responseJsonSchema', body['generationConfig'])
        self.assertEqual(body['generationConfig']['responseSchema']['type'], 'OBJECT')
        image_part = body['contents'][0]['parts'][1]['inlineData']
        self.assertEqual(image_part.get('mimeType', image_part.get('mime_type')), 'image/png')
        self.db.assert_not_called()

    def test_expiry_estimate_uses_native_nullable_schema(self):
        value = (date.today() + timedelta(days=2)).isoformat()
        self.output = {'expiry_date': value}
        response = self.api.post('/inventory/estimate-expiry', json={'name': 'spinach'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['expiry_date'], value)
        config = self.payload()['generationConfig']
        self.assertIn('responseSchema', config)
        self.assertTrue(config['responseSchema']['properties']['expiry_date']['nullable'])
        self.assertNotIn('responseJsonSchema', config)
        self.db.assert_not_called()

    def test_meals_keep_json_schema_and_return_two_real_sdk_responses(self):
        self.output = {'recipes': [
            {'title': title, 'cooking_time_minutes': 10, 'ingredients': [{'name': name, 'quantity': 50, 'unit': 'g'}],
             'instructions': [instruction], 'expiry_priority_reasoning': 'Prioritise available food.'}
            for title, name, instruction in [('Spinach bowl', 'spinach', 'Wilt the spinach.'), ('Rice bowl', 'rice', 'Boil the rice.')]
        ]}
        response = self.api.post('/meals/recommend', json={'minutes': 15})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['source'], 'gemini')
        self.assertEqual(len(response.json()['recipes']), 2)
        config = self.payload()['generationConfig']
        self.assertEqual(config['responseJsonSchema']['type'], 'object')
        self.assertNotIn('responseSchema', config)

    def test_provider_error_is_logged_with_key_redacted(self):
        error = main.genai_errors.ClientError(400, {'error': {'code': 400, 'status': 'INVALID_ARGUMENT', 'message': 'Key mock-only-key is invalid.'}})
        with self.assertLogs(level='WARNING') as output:
            main.log_gemini_error(error)
        text = '\n'.join(output.output)
        self.assertIn('HTTP 400 INVALID_ARGUMENT', text)
        self.assertIn('<redacted>', text)
        self.assertNotIn('mock-only-key', text)

    def test_high_demand_error_remains_visible_without_retries(self):
        self.status = 503
        self.output = {'error': {'code': 503, 'status': 'UNAVAILABLE', 'message': 'This model is currently experiencing high demand.'}}
        image = BytesIO()
        Image.new('RGB', (2, 2)).save(image, format='PNG')
        with self.assertLogs(level='WARNING') as logs:
            response = self.api.post('/scan', files={'image': ('fixture.png', image.getvalue(), 'image/png')})
        self.assertEqual(response.status_code, 502)
        self.assertEqual(len(self.calls), 1)
        self.assertIn('high demand', '\n'.join(logs.output))
        self.assertNotIn('items', response.json())
        self.db.assert_not_called()


if __name__ == '__main__':
    unittest.main()
