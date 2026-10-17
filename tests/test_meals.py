"""Offline meal endpoint tests. All database access and Gemini calls are mocked."""
import copy
import json
import sys
import unittest
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
with patch('dotenv.load_dotenv'):
    import main
from fastapi.testclient import TestClient


class MealTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.dict(main.os.environ, {'GEMINI_API_KEY': 'mock-only'}).start()
        self.gemini = patch.object(main.genai, 'Client').start()
        self.generate = self.gemini.return_value.__enter__.return_value.models.generate_content
        self.connection = MagicMock()
        patch.object(main, 'inventory_connection').start().return_value.__enter__.return_value = self.connection
        self.today = date.today()
        self.connection.execute.return_value.fetchall.return_value = [
            (1, 'rice', Decimal('250'), 'g', self.today + timedelta(days=10), 'printed', True),
            (2, 'spinach', Decimal('50'), 'g', self.today + timedelta(days=1), 'estimated', False),
            (3, 'oil', Decimal('20'), 'ml', None, 'unknown', False),
            (4, 'old milk', Decimal('1'), 'pack', self.today - timedelta(days=1), 'printed', True),
            (5, 'past estimate', Decimal('1'), 'pack', self.today - timedelta(days=1), 'estimated', False),
        ]
        self.recipes = {'recipes': [
            {'title': 'Rice bowl', 'cooking_time_minutes': 15,
             'ingredients': [{'name': 'rice', 'quantity': 300, 'unit': 'g'}],
             'instructions': ['Boil rice until cooked.'], 'expiry_priority_reasoning': 'Rice is in stock.'},
            {'title': 'Spinach soup', 'cooking_time_minutes': 10,
             'ingredients': [{'name': 'spinach', 'quantity': 100, 'unit': 'g'}, {'name': 'salt', 'quantity': 1, 'unit': 'g'}],
             'instructions': ['Simmer spinach in water.'], 'expiry_priority_reasoning': 'Use spinach first.'},
        ]}
        self.client = TestClient(main.app)

    def recommend(self, payload=None):
        self.generate.return_value = SimpleNamespace(text=json.dumps(self.recipes))
        return self.client.post('/meals/recommend', json=payload or {})

    def test_priority_availability_and_one_text_call(self):
        response = self.recommend({'dietary_restrictions': ['vegetarian'], 'rejected_meals': ['Omelette']})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(body['recipes']), 2)
        self.assertEqual(body['excluded_item_count'], 2)
        soup, rice = body['recipes']
        self.assertEqual(soup['title'], 'Spinach soup')
        self.assertEqual(soup['ingredients'][0]['pantry_quantity'], 50)
        self.assertEqual(soup['ingredients'][0]['missing_quantity'], 50)
        self.assertFalse(soup['ingredients'][0]['in_stock'])
        self.assertEqual(soup['missing_ingredients'], [{'name': 'spinach', 'quantity': 50, 'unit': 'g'}, {'name': 'salt', 'quantity': 1, 'unit': 'g'}])
        self.assertEqual(soup['freshness_checks'], ['spinach'])
        self.assertEqual(rice['ingredients'][0]['missing_quantity'], 50)
        self.assertEqual(rice['freshness_checks'], [])
        self.assertNotIn('Rice is in stock', rice['expiry_priority_reasoning'])
        self.generate.assert_called_once()
        kwargs = self.generate.call_args.kwargs
        self.assertEqual(len(kwargs['contents']), 1)
        self.assertIsInstance(kwargs['contents'][0], str)
        data = json.loads(kwargs['contents'][0].split('Input JSON: ')[1])
        self.assertEqual([i['name'] for i in data['pantry']], ['spinach', 'rice', 'oil'])
        self.assertEqual(data['dietary_restrictions'], ['vegetarian'])
        self.assertEqual(data['rejected_meals'], ['Omelette'])
        self.assertEqual(self.gemini.call_args.kwargs['http_options'].retry_options.attempts, 1)
        self.connection.execute.assert_called_once()
        sql = self.connection.execute.call_args.args[0]
        self.assertIn("status = 'active'", sql)
        self.assertIn('quantity > 0', sql)
        self.assertTrue(sql.strip().startswith('SELECT'))

    def test_unknowns_and_unit_mismatch_are_cautious(self):
        self.recipes['recipes'][0]['ingredients'] = [
            {'name': 'oil', 'quantity': 10, 'unit': 'ml'},
            {'name': 'rice', 'quantity': 1, 'unit': 'pack'},
            {'name': 'old milk', 'quantity': 1, 'unit': 'pack'},
        ]
        recipe = self.recommend().json()['recipes'][1]
        self.assertEqual(recipe['freshness_checks'], ['oil'])
        self.assertEqual(recipe['ingredients'][1]['pantry_quantity'], 0)
        self.assertEqual(recipe['ingredients'][2]['pantry_quantity'], 0)
        self.assertEqual(recipe['ingredients'][2]['missing_quantity'], 1)

    def test_multiple_lots_sum_and_alternatives_do_not_share_budget(self):
        self.connection.execute.return_value.fetchall.return_value.append(
            (6, 'rice', Decimal('50'), 'g', self.today + timedelta(days=12), 'estimated', True))
        self.recipes['recipes'][1]['ingredients'] = [{'name': 'rice', 'quantity': 300, 'unit': 'g'}]
        body = self.recommend().json()
        for recipe in body['recipes']:
            self.assertEqual(recipe['ingredients'][0]['pantry_quantity'], 300)
            self.assertTrue(recipe['ingredients'][0]['in_stock'])
            self.assertEqual(recipe['missing_ingredients'], [])
            self.assertEqual(recipe['freshness_checks'], ['rice'])

    def test_malformed_structured_output(self):
        original = copy.deepcopy(self.recipes)
        mutations = [
            lambda r: r['recipes'].pop(),
            lambda r: r['recipes'].append(copy.deepcopy(r['recipes'][0])),
            lambda r: r['recipes'][0].update(title='   '),
            lambda r: r['recipes'][0].update(cooking_time_minutes=0),
            lambda r: r['recipes'][0].update(cooking_time_minutes=True),
            lambda r: r['recipes'][0].update(instructions=['  ']),
            lambda r: r['recipes'][0]['ingredients'][0].update(quantity=-1),
            lambda r: r['recipes'][0]['ingredients'][0].update(quantity='300'),
            lambda r: r['recipes'][0]['ingredients'][0].update(quantity=True),
            lambda r: r['recipes'][0]['ingredients'][0].update(quantity=float('nan')),
            lambda r: r['recipes'][0]['ingredients'].append(copy.deepcopy(r['recipes'][0]['ingredients'][0])),
            lambda r: r['recipes'][1].update(title='rice bowl'),
            lambda r: r['recipes'][1].update(instructions=r['recipes'][0]['instructions']),
        ]
        for mutate in mutations:
            self.recipes = copy.deepcopy(original)
            mutate(self.recipes)
            with self.subTest(mutation=mutate):
                self.assertEqual(self.recommend().status_code, 502)
        self.generate.return_value = SimpleNamespace(text='not json')
        self.assertEqual(self.client.post('/meals/recommend', json={}).status_code, 502)

    def test_rejected_and_unrelated_meals_are_not_returned(self):
        self.assertEqual(self.recommend({'rejected_meals': [' Rice Bowl ']}).status_code, 502)
        self.recipes['recipes'][0]['ingredients'] = [{'name': 'unavailable', 'quantity': 1, 'unit': 'g'}]
        self.assertEqual(self.recommend().status_code, 502)

    def test_empty_and_all_past_inventory_do_not_call_gemini(self):
        for rows in ([], [(1, 'milk', Decimal('1'), 'pack', self.today - timedelta(days=1), 'estimated', True)]):
            self.connection.execute.return_value.fetchall.return_value = rows
            response = self.recommend()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['recipes'], [])
        self.generate.assert_not_called()

    def test_missing_key_quota_and_upstream_errors(self):
        with patch.dict(main.os.environ, {'GEMINI_API_KEY': ''}):
            self.assertEqual(self.recommend().status_code, 503)
        self.generate.assert_not_called()
        for error, expected in [
            (main.genai_errors.ClientError(429, {'error': {'message': 'sensitive mock'}}), 429),
            (main.genai_errors.ClientError(400, {'error': {'message': 'sensitive mock'}}), 502),
            (RuntimeError('sensitive mock'), 503),
        ]:
            self.generate.side_effect = error
            response = self.recommend()
            self.assertEqual(response.status_code, expected)
            self.assertNotIn('sensitive mock', response.text)

    def test_database_error_is_graceful(self):
        self.connection.execute.side_effect = main.psycopg.OperationalError('sensitive mock')
        response = self.recommend()
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('sensitive mock', response.text)
        self.generate.assert_not_called()

    def test_invalid_preferences_rejected_before_gemini(self):
        for payload in ({'dietary_restrictions': ['']}, {'rejected_meals': ['x' * 201]}, {'dietary_restrictions': ['vegan'] * 21}):
            self.assertEqual(self.recommend(payload).status_code, 422)
        self.generate.assert_not_called()


if __name__ == '__main__':
    unittest.main()
