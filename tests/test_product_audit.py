"""Offline validation checks for the final product pass."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
with patch('dotenv.load_dotenv'):
    import main
from fastapi.testclient import TestClient


class ProductAuditTests(unittest.TestCase):
    def test_invalid_quantity_never_reaches_inventory_storage(self):
        with patch.object(main, 'inventory_connection') as db:
            client = TestClient(main.app)
            for quantity in (0, -1, 0.001, 1000001):
                response = client.post('/inventory', json={'name': 'test', 'quantity': quantity})
                self.assertEqual(response.status_code, 422)
            db.assert_not_called()

    def test_both_documented_localhost_origins_can_reach_api(self):
        client = TestClient(main.app)
        for origin in ('http://localhost:5500', 'http://127.0.0.1:5500'):
            response = client.options('/inventory', headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['access-control-allow-origin'], origin)

    def test_gemini_requests_have_bounded_waits_and_no_retries(self):
        with patch.object(main.genai, 'Client') as client, patch.dict(main.os.environ, {'GEMINI_API_KEY': 'mock-only'}):
            main.gemini_client(6000)
            options = client.call_args.kwargs['http_options']
            self.assertEqual(options.timeout, 6000)
            self.assertEqual(options.retry_options.attempts, 1)


if __name__ == '__main__':
    unittest.main()
