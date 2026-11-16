#!/bin/sh
# Creates three databases and three users; each user may only access its own database.
set -eu

create_db() {
  name="$1"; password="$2"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE ${name} LOGIN PASSWORD '${password}';
CREATE DATABASE ${name}_db OWNER ${name};
REVOKE ALL ON DATABASE ${name}_db FROM PUBLIC;
GRANT ALL ON DATABASE ${name}_db TO ${name};
SQL
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "${name}_db" <<SQL
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO ${name};
SQL
}

create_db catalog "$CATALOG_DB_PASSWORD"
create_db quiz "$QUIZ_DB_PASSWORD"
create_db analytics "$ANALYTICS_DB_PASSWORD"
