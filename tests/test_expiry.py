"""Offline API verification: Gemini and PostgreSQL are always mocked."""
import json
import sys
import unittest
from datetime import date, datetime, timedelta
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
# Do not load developer secrets, even when importing the application.
with patch('dotenv.load_dotenv'):
    import main
from fastapi.testclient import TestClient
from PIL import Image


class ExpiryTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(main.os.environ, {'GEMINI_API_KEY': 'mock-only'})
        self.env.start()
        self.gemini = patch.object(main.genai, 'Client').start()
        self.generate = self.gemini.return_value.__enter__.return_value.models.generate_content
        self.rows = []
        self.events = []
        self.eaten = set()
        connection = MagicMock()
        connection.execute.side_effect = self.execute
        self.db = patch.object(main, 'inventory_connection').start()
        self.db.return_value.__enter__.return_value = connection
        self.client = TestClient(main.app)
        self.addCleanup(patch.stopall)
        self.addCleanup(self.env.stop)

    def execute(self, sql, params=None):
        cursor = MagicMock()
        if 'INSERT INTO inventory (' in sql:
            row = [len(self.rows) + 1, *params, datetime(2026, 1, 1)]
            self.rows.append(row)
            cursor.fetchone.return_value = row
        elif 'INSERT INTO inventory_events' in sql:
            self.events.append(params)
        elif 'SELECT id, name' in sql:
            self.assertIn("WHERE status = 'active'", sql)
            cursor.fetchall.return_value = [r for r in self.rows if r[0] not in self.eaten]
        elif "UPDATE inventory SET status = 'eaten'" in sql:
            self.assertIn("AND status = 'active'", sql)
            row = next((r for r in self.rows if r[0] == params[0] and r[0] not in self.eaten), None)
            cursor.fetchone.return_value = (row[0], row[2]) if row else None
            if row:
                self.eaten.add(row[0])
        elif 'SET name = %s' in sql:
            self.assertIn("AND status = 'active'", sql)
            row = next((r for r in self.rows if r[0] == params[-1] and r[0] not in self.eaten), None)
            if row:
                row[1:5] = params[:4]
                row[5] = 'unknown' if params[3] is None else ('estimated' if row[5] == 'unknown' else row[5])
                row[6] = params[3] is not None
            cursor.fetchone.return_value = (row[0],) if row else None
        elif 'SELECT id FROM inventory' in sql:
            cursor.fetchone.return_value = next(((r[0],) for r in self.rows if r[0] == params[0]), None)
        elif 'UPDATE inventory' in sql:
            row = next((r for r in self.rows if r[0] == params[1]), None)
            if row:
                self.assertIn("WHEN expiry_date_source = 'unknown'", sql)
                row[4], row[5], row[6] = params[0], 'estimated' if row[5] == 'unknown' else row[5], True
            cursor.fetchone.return_value = [row[0], *row[4:7]] if row else None
        return cursor

    def estimate(self, value):
        self.generate.return_value = SimpleNamespace(text=json.dumps({'expiry_date': value}))
        return self.client.post('/inventory/estimate-expiry', json={'name': 'milk'}).json()

    def save(self, metadata):
        response = self.client.post('/inventory', json={'name': 'milk', 'quantity': 1, **metadata})
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_manual_estimate_save_confirm_edit_refresh(self):
        value = (date.today() + timedelta(days=3)).isoformat()
        item = self.save(self.estimate(value))
        self.assertEqual(item['expiry_date'], value)
        self.assertFalse(item['expiry_date_confirmed'])
        for edited in (value, (date.today() + timedelta(days=2)).isoformat()):
            response = self.client.patch(f"/inventory/{item['id']}/expiry", json={'expiry_date': edited})
            self.assertEqual(response.status_code, 200)
            refreshed = self.client.get('/inventory').json()[0]
            self.assertEqual(refreshed['expiry_date'], edited)
            self.assertEqual(refreshed['expiry_date_source'], 'estimated')
            self.assertTrue(refreshed['expiry_date_confirmed'])
        self.assertEqual(self.generate.call_count, 1)
        self.assertEqual(len(self.events), 1)

    def test_quota_429_still_saves_unknown(self):
        self.generate.side_effect = main.genai_errors.ClientError(429, {'error': {'message': 'mock quota'}})
        response = self.client.post('/inventory/estimate-expiry', json={'name': 'milk'})
        self.assertEqual(response.status_code, 200)
        item = self.save(response.json())
        self.assertIsNone(item['expiry_date'])
        self.assertEqual(item['expiry_date_source'], 'unknown')
        self.assertFalse(item['expiry_date_confirmed'])
        self.assertEqual(self.client.get('/inventory').json()[0], item)
        self.assertEqual(self.generate.call_count, 1)

    def test_camera_single_request_preserves_sources(self):
        value = (date.today() + timedelta(days=2)).isoformat()
        self.generate.return_value = SimpleNamespace(text=json.dumps({'items': [
            {'name': 'milk', 'quantity': 1, 'expiry_date': d, 'expiry_date_source': s}
            for d, s in [('2020-01-01', 'printed'), (value, 'estimated'), (None, 'unknown')]
        ]}))
        image = BytesIO()
        Image.new('RGB', (2, 2)).save(image, format='PNG')
        response = self.client.post('/scan', files={'image': ('mock.png', image.getvalue(), 'image/png')})
        self.assertEqual(response.status_code, 200)
        for detected in response.json()['items']:
            item = self.save({k: detected[k] for k in ('expiry_date', 'expiry_date_source')})
            self.assertEqual(item['expiry_date'], detected['expiry_date'])
        self.assertEqual(self.generate.call_count, 1)

    def test_invalid_estimates_are_unknown(self):
        for value in (None, 'not-a-date', '2026-02-30', '20261020',
                      (date.today() - timedelta(days=1)).isoformat(),
                      (date.today() + timedelta(days=366)).isoformat()):
            with self.subTest(value=value):
                self.assertEqual(self.estimate(value), main.unknown_expiry_estimate())
                self.assertEqual(main.normalise_expiry_metadata({'expiry_date': value, 'expiry_date_source': 'estimated'}), (None, 'unknown'))

    def test_malformed_inventory_dates_rejected(self):
        for value in ('2026-02-30', 'garbage'):
            self.assertEqual(self.client.post('/inventory', json={'name': 'milk', 'quantity': 1, 'expiry_date': value, 'expiry_date_source': 'printed'}).status_code, 422)
            self.assertEqual(self.client.patch('/inventory/1/expiry', json={'expiry_date': value}).status_code, 422)
        self.assertEqual(self.client.patch('/inventory/999/expiry', json={'expiry_date': '2026-10-20'}).status_code, 404)

    def test_edit_eaten_history_and_retry(self):
        item = self.save({'expiry_date': '2026-10-20', 'expiry_date_source': 'printed'})
        path = f"/inventory/{item['id']}"
        payload = {'name': ' Milk edited ', 'quantity': 2.25, 'unit': ' packs ', 'expiry_date': '2026-10-22'}
        self.assertEqual(self.client.patch(path, json=payload).status_code, 200)
        refreshed = self.client.get('/inventory').json()[0]
        self.assertEqual((refreshed['name'], refreshed['quantity'], refreshed['unit']), ('Milk edited', 2.25, 'packs'))
        self.assertEqual(refreshed['expiry_date'], '2026-10-22')
        self.assertEqual(refreshed['expiry_date_source'], 'printed')
        self.assertTrue(refreshed['expiry_date_confirmed'])
        for _ in range(2):
            self.assertEqual(self.client.post(path + '/eaten').status_code, 200)
        self.assertEqual(self.client.get('/inventory').json(), [])
        self.assertEqual(len(self.rows), 1)  # Preserved, not deleted.
        self.assertEqual(self.events, [(item['id'], 'ADD', 1), (item['id'], 'EATEN', -2.25)])
        self.assertEqual(self.client.patch(path, json=payload).status_code, 404)
        self.assertEqual(self.client.post('/inventory/999/eaten').status_code, 404)
        self.generate.assert_not_called()

    def test_unchanged_estimated_date_is_confirmed_by_existing_edit_and_persists(self):
        item = self.save({'expiry_date': '2026-10-21', 'expiry_date_source': 'estimated'})
        self.assertFalse(item['expiry_date_confirmed'])
        response = self.client.patch(f"/inventory/{item['id']}", json={
            'name': item['name'], 'quantity': item['quantity'], 'unit': item['unit'], 'expiry_date': item['expiry_date']
        })
        self.assertEqual(response.status_code, 200)
        update_sql = next(call.args[0] for call in self.db.return_value.__enter__.return_value.execute.call_args_list if 'SET name = %s' in call.args[0])
        self.assertIn('expiry_date_confirmed = (%s::date IS NOT NULL)', update_sql)
        self.assertIn("ELSE expiry_date_source END", update_sql)
        for _ in range(2):
            refreshed = self.client.get('/inventory').json()[0]
            self.assertEqual(refreshed['expiry_date'], '2026-10-21')
            self.assertEqual(refreshed['expiry_date_source'], 'estimated')
            self.assertTrue(refreshed['expiry_date_confirmed'])
        self.assertEqual(len(self.events), 1)  # Confirmation does not add or consume stock.
        self.generate.assert_not_called()

    def test_edit_validation_and_clear_expiry(self):
        item = self.save({'expiry_date': '2026-10-20', 'expiry_date_source': 'estimated'})
        path = f"/inventory/{item['id']}"
        payload = {'name': 'milk', 'quantity': 1, 'unit': '', 'expiry_date': None}
        for field, value in [('quantity', 0), ('quantity', -1), ('quantity', 0.001), ('quantity', 1000001), ('name', '   '), ('expiry_date', '2026-02-30')]:
            self.assertEqual(self.client.patch(path, json={**payload, field: value}).status_code, 422)
        self.assertEqual(self.client.patch(path, json=payload).status_code, 200)
        refreshed = self.client.get('/inventory').json()[0]
        self.assertIsNone(refreshed['expiry_date'])
        self.assertEqual(refreshed['expiry_date_source'], 'unknown')
        self.assertFalse(refreshed['expiry_date_confirmed'])


if __name__ == '__main__':
    unittest.main()
