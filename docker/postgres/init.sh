#!/bin/bash
set -e

# Подключаемся к PostgreSQL и проверяем, существует ли база
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_database WHERE datname = '$POSTGRES_DB') THEN
            CREATE DATABASE $POSTGRES_DB;
        END IF;
    END
    \$\$;
EOSQL