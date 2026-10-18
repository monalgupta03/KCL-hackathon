"""Small, deterministic fallback; quantities always come from the eligible pantry."""
from decimal import Decimal
import re


def grocery_name(name):
    name = name.strip().casefold()
    if name.startswith('[demo] '):
        name = name[7:]
    return {'tomatoes': 'tomato', 'egg': 'eggs', 'mushroom': 'mushrooms'}.get(name, name)


# Ingredient requirements use grams, millilitres, or known individual items only.
DEMO_RECIPES = [
    ('Spinach tomato salad', 5, [('spinach', 50, 'g'), ('tomato', 1, 'pieces')], set(),
     ['Wash the spinach and tomato.', 'Chop the tomato and toss with the spinach.']),
    ('Spinach egg scramble', 5, [('spinach', 30, 'g'), ('eggs', 1, 'pieces')], {'egg'},
     ['Wash the spinach and beat the egg.', 'Wilt spinach in a nonstick pan with a splash of water. Add the egg and stir until fully set; allow extra time if needed.']),
    ('Tomato scrambled eggs', 5, [('tomato', 1, 'pieces'), ('eggs', 1, 'pieces')], {'egg'},
     ['Wash and finely chop the tomato; beat the egg.', 'Soften tomato in a nonstick pan with a splash of water. Stir in the egg and cook until fully set.']),
    ('Spinach tomato pasta', 15, [('spinach', 50, 'g'), ('tomato', 1, 'pieces'), ('pasta', 100, 'g')], {'gluten'},
     ['Boil pasta in water according to its packet instructions.', 'Wash spinach and tomato. Chop and simmer the tomato with a little water, then wilt the spinach.', 'Drain the pasta and combine with the vegetables.']),
    ('Mushroom pasta', 15, [('mushrooms', 75, 'g'), ('pasta', 100, 'g')], {'gluten'},
     ['Boil pasta in water according to its packet instructions.', 'Clean and slice mushrooms. Cook in a nonstick pan with a little water until tender.', 'Drain pasta and toss with the mushrooms.']),
    ('Mushroom eggs', 15, [('mushrooms', 75, 'g'), ('eggs', 2, 'pieces')], {'egg'},
     ['Clean and slice mushrooms; beat the eggs.', 'Cook mushrooms in a nonstick pan with a splash of water until tender.', 'Add eggs and stir until fully set.']),
    ('Spinach mushroom rice', 30, [('spinach', 50, 'g'), ('mushrooms', 75, 'g'), ('rice', 75, 'g')], set(),
     ['Cook rice in water according to the packet instructions.', 'Wash spinach; clean and slice mushrooms. Simmer mushrooms with a little water until tender and wilt spinach.', 'Combine with the cooked rice and serve hot.']),
]
RESTRICTIONS = {
    'vegetarian': set(), 'vegan': {'egg', 'dairy'},
    'egg-free': {'egg'}, 'no eggs': {'egg'},
    'dairy-free': {'dairy'}, 'no dairy': {'dairy'}, 'lactose-free': {'dairy'},
    'gluten-free': {'gluten'}, 'wheat-free': {'gluten'},
    'nut-free': {'nuts'}, 'no nuts': {'nuts'},
}


def violates_dietary(ingredients, restrictions):
    """Reject obvious conflicts in model output; do not certify allergy safety."""
    foods = " ".join(ingredient.name.casefold() for ingredient in ingredients)
    preferences = {value.strip().casefold() for value in restrictions}
    meat = r"\b(chicken|beef|pork|bacon|ham|meat|fish|salmon|tuna|shrimp|prawn|anchovy|gelatin)\b"
    dairy = r"\b(milk|cheese|cream|butter|yogurt|yoghurt|whey)\b"
    eggs = r"\b(egg|eggs)\b"
    gluten = r"\b(wheat|pasta|bread|couscous|barley|rye|flour)\b"
    if preferences & {"vegan", "vegetarian"} and re.search(meat, foods):
        return True
    if preferences & {"vegan", "egg-free", "no eggs"} and re.search(eggs, foods):
        return True
    if preferences & {"vegan", "dairy-free", "no dairy", "lactose-free"} and re.search(dairy, foods):
        return True
    if preferences & {"gluten-free", "wheat-free"} and any(
        re.search(gluten, i.name.casefold()) and "gluten-free" not in i.name.casefold() and "gluten free" not in i.name.casefold()
        for i in ingredients
    ):
        return True
    return False


def demo_meals(pantry, minutes, dietary_restrictions, rejected_meals):
    excluded = set()
    for restriction in dietary_restrictions:
        key = restriction.strip().casefold()
        if key not in RESTRICTIONS:
            return []  # Do not guess how to satisfy an unfamiliar restriction.
        excluded.update(RESTRICTIONS[key])
    rejected = {title.strip().casefold() for title in rejected_meals}
    candidates = []
    for title, duration, requirements, allergens, instructions in DEMO_RECIPES:
        if duration > minutes or title.casefold() in rejected or allergens & excluded:
            continue
        ingredients, used = [], []
        for food, quantity, unit in requirements:
            matches = [item for item in pantry if grocery_name(item['name']) == food and (
                item['unit'].strip().casefold() in ({'g', 'gram', 'grams'} if unit == 'g' else
                    {'ml', 'millilitre', 'millilitres'} if unit == 'ml' else {'', 'piece', 'pieces'}))]
            # Keep exact database names and units; never combine incompatible measurements.
            selected = None
            for item in matches:
                lots = [i for i in matches if i['name'] == item['name'] and i['unit'] == item['unit']]
                if sum(Decimal(str(i['quantity'])) for i in lots) >= quantity:
                    selected = item
                    break
            if selected is None:
                break
            ingredients.append({'name': selected['name'], 'quantity': quantity, 'unit': selected['unit']})
            used.extend(i for i in matches if i['name'] == selected['name'] and i['unit'] == selected['unit'])
        else:
            earliest = min((i['expiry_date'] for i in used if i['expiry_date']), default='9999-12-31')
            candidates.append((earliest, -duration, title, {
                'title': title, 'cooking_time_minutes': duration, 'ingredients': ingredients,
                'instructions': instructions, 'expiry_priority_reasoning': 'Uses eligible pantry ingredients closest to their freshness dates.',
            }))
    return [entry[3] for entry in sorted(candidates, key=lambda entry: entry[:3])[:2]]
