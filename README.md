# Sales Service

Microservicio NestJS para la gestion de ventas y sus catalogos base.

## Instalacion

```bash
cp .env.example .env
pnpm install
```

La base utiliza el esquema configurado en `DB_SCHEMA` (`sales` por defecto).
Los seeders mantienen seguimiento de ejecucion mediante `track = true`.

## Base De Datos

Las migraciones se encuentran en `src/database/migrations` y los seeders en
`src/database/seeds`.

```bash
# Crear o consultar migraciones
pnpm migration:create nombre-de-la-migracion
pnpm migration:show

# Preparar datos iniciales
pnpm migration:run
pnpm build
pnpm seed:run

# Crear nuevos seeders o revertir una migracion
pnpm seed:create nombre-del-seeder
pnpm migration:revert
```

La compilacion previa al seeder permite que `typeorm-extension` ejecute los
archivos actuales.

## Desarrollo

```bash
pnpm start:dev
```
