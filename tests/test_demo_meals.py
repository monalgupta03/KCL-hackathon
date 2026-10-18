"""Quantity and dietary checks for the offline demo fallback."""
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from demo_meals import demo_meals


class DemoMealTests(unittest.TestCase):
    def pantry(self):
        return [dict(id=index, name=name, quantity=qty, unit=unit,
                     expiry_date=(date.today()+timedelta(days=days)).isoformat(),
                     expiry_date_source='estimated', expiry_date_confirmed=False)
                for index, (name, qty, unit, days) in enumerate([
                    ('[DEMO] spinach', 200, 'g', 1), ('tomatoes', 4, 'pieces', 4),
                    ('pasta', 500, 'g', 180), ('eggs', 4, 'pieces', 10),
                    ('milk', 500, 'ml', 5), ('mushrooms', 200, 'g', 2), ('rice', 500, 'g', 180)], 1)]

    def test_limits_and_exact_stock_names(self):
        pantry = self.pantry()
        for minutes in (5, 15, 30):
            recipes = demo_meals(pantry, minutes, [], [])
            self.assertEqual(len(recipes), 2)
            self.assertEqual(len({r['title'] for r in recipes}), 2)
            for recipe in recipes:
                self.assertLessEqual(recipe['cooking_time_minutes'], minutes)
                self.assertTrue(recipe['instructions'])
                for ingredient in recipe['ingredients']:
                    lot = next(i for i in pantry if i['name'] == ingredient['name'])
                    self.assertEqual(lot['unit'], ingredient['unit'])
                    self.assertLessEqual(ingredient['quantity'], lot['quantity'])
            self.assertIn('[DEMO] spinach', [i['name'] for i in recipes[0]['ingredients']])

    def test_dietary_and_rejected_recipes(self):
        pantry = self.pantry()
        recipes = demo_meals(pantry, 30, ['vegan', 'gluten-free'], [])
        self.assertTrue(recipes)
        for recipe in recipes:
            self.assertFalse({'eggs','milk','pasta'} & {i['name'] for i in recipe['ingredients']})
        rejected = [r['title'] for r in demo_meals(pantry, 5, [], [])]
        self.assertFalse(set(rejected) & {r['title'] for r in demo_meals(pantry, 5, [], rejected)})
        self.assertEqual(demo_meals(pantry, 30, ['unrecognised medical restriction'], []), [])

    def test_missing_or_insufficient_stock_never_invents_meals(self):
        self.assertEqual(demo_meals([], 30, [], []), [])
        pantry = self.pantry()
        for item in pantry:
            item['quantity'] = 0.001
        self.assertEqual(demo_meals(pantry, 30, [], []), [])
        # A bag is not assumed to contain a known weight.
        pantry = self.pantry()[:2]
        pantry[0]['unit'] = 'bag'
        self.assertEqual(demo_meals(pantry, 30, [], []), [])


if __name__ == '__main__':
    unittest.main()
