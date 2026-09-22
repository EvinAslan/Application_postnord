from faker import Faker
import json, random

fake = Faker("sv_SE")
Faker.seed(42); random.seed(42)  # samma data varje körning

register = [{
    "id": i,
    "namn": fake.name(),
    "gata": fake.street_address(),
    "postnummer": fake.postcode(),
    "ort": fake.city(),
    "bor_kvar": random.random() > 0.2,  # ca 20 % har "flyttat"
} for i in range(50)]

with open("register.json", "w", encoding="utf-8") as f:
    json.dump(register, f, ensure_ascii=False, indent=2)