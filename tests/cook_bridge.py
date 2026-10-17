"""Test-only HTTP bridge: real FastAPI routes, fully mocked PostgreSQL and Gemini."""
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
with patch('dotenv.load_dotenv'):
    import main
from fastapi.testclient import TestClient


def fixture_inventory():
    names = [('spinach', 200, 'g', 1), ('mushrooms', 250, 'g', 2),
             ('pasta', 500, 'g', 180), ('cheese', 200, 'g', 14),
             ('canned chickpeas', 400, 'g', 365), ('eggs', 1, '', None), ('tomato', 3, '', None)]
    return [{'id': index, 'name': name, 'quantity': quantity, 'unit': unit,
             'expiry_date': (date.today() + timedelta(days=days)).isoformat() if days else None,
             'expiry_date_source': 'estimated' if days else 'unknown', 'expiry_date_confirmed': False}
            for index, (name, quantity, unit, days) in enumerate(names, 1)]


def mocked_meals(minutes):
    def recipe(title, time, ingredients, step):
        return {'title': title, 'cooking_time_minutes': time,
                'ingredients': [{'name': name, 'quantity': qty, 'unit': unit} for name, qty, unit in ingredients],
                'instructions': [step], 'expiry_priority_reasoning': 'Use soon ingredients first.'}
    if minutes == 5:
        recipes = [recipe('Spinach tomato salad', 5, [('spinach', 50, 'g'), ('tomato', 1, '')], 'Wash and combine spinach and chopped tomato.'),
                   recipe('Chickpea tomato salad', 5, [('canned chickpeas', 100, 'g'), ('tomato', 1, '')], 'Drain canned chickpeas and combine with chopped tomato.')]
    elif minutes == 15:
        recipes = [recipe('Spinach mushroom pasta', 15, [('spinach', 75, 'g'), ('mushrooms', 80, 'g'), ('pasta', 100, 'g')], 'Boil pasta; cook mushrooms and spinach with a little water, then combine.'),
                   recipe('Tomato spinach scramble', 10, [('eggs', 1, ''), ('tomato', 1, ''), ('spinach', 30, 'g')], 'Cook tomato and spinach in a nonstick pan with a little water, add beaten egg and cook through.')]
    else:
        recipes = [recipe('Spinach cheese pasta bake', 30, [('spinach', 75, 'g'), ('pasta', 100, 'g'), ('cheese', 30, 'g')], 'Boil pasta, wilt spinach, combine with cheese and bake until hot.'),
                   recipe('Mushroom chickpea stew', 25, [('mushrooms', 100, 'g'), ('canned chickpeas', 100, 'g'), ('tomato', 1, '')], 'Simmer chopped tomato and mushrooms with water, then add drained canned chickpeas and heat through.')]
    return {'recipes': recipes}


def respond(message):
    snapshot = os.getenv('SAVOURIT_TEST_INVENTORY')
    inventory = json.loads(Path(snapshot).read_text()) if snapshot else fixture_inventory()
    scenario = message.get('scenario')
    if scenario == 'empty':
        inventory = []
    for item in inventory:
        item['created_at'] = item.get('created_at', '2026-10-18T00:00:00Z')
    connection = MagicMock()

    def execute(sql, params=None):
        cursor = MagicMock()
        if sql.strip().startswith('SELECT'):
            assert "status = 'active'" in sql
            keys = ['id', 'name', 'quantity', 'unit', 'expiry_date', 'expiry_date_source', 'expiry_date_confirmed']
            if 'created_at' in sql:
                keys.append('created_at')
            cursor.fetchall.return_value = [tuple(date.fromisoformat(item[k]) if k == 'expiry_date' and item[k] else item[k] for k in keys) for item in inventory]
        else:
            assert sql.strip().startswith(('CREATE TABLE', 'ALTER TABLE'))  # Existing GET schema setup only.
        return cursor

    connection.execute.side_effect = execute
    with patch.dict(main.os.environ, {'GEMINI_API_KEY': 'mock-only'}), \
            patch.object(main, 'inventory_connection') as db, \
            patch.object(main.psycopg, 'connect', side_effect=AssertionError('Real database forbidden')), \
            patch.object(main.genai, 'Client') as gemini:
        db.return_value.__enter__.return_value = connection
        generate = gemini.return_value.__enter__.return_value.models.generate_content
        def generate_content(**kwargs):
            assert len(kwargs['contents']) == 1 and isinstance(kwargs['contents'][0], str)
            data = json.loads(kwargs['contents'][0].split('Input JSON: ')[1])
            assert data['minutes'] == message['body']['minutes']
            if scenario == 'quota':
                raise main.genai_errors.ClientError(429, {'error': {'message': 'mock quota'}})
            result = mocked_meals(data['minutes'])
            if scenario == 'overlimit':
                result['recipes'][0]['cooking_time_minutes'] = data['minutes'] + 1
            if scenario == 'missing':
                result['recipes'][0]['ingredients'].append({'name': 'olive oil', 'quantity': 10, 'unit': 'ml'})
            if scenario == 'malformed':
                return SimpleNamespace(text='bad json')
            return SimpleNamespace(text=json.dumps(result))
        generate.side_effect = generate_content
        with TestClient(main.app) as client:
            response = client.request(message['method'], message['path'], json=message.get('body'))
        return {'status': response.status_code, 'body': response.json(), 'gemini_calls': generate.call_count}


if __name__ == '__main__':
    print(json.dumps(respond(json.load(sys.stdin))))
