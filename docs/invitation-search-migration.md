# Migración del índice de invitaciones

## Índice derivado

`searchPrefixes` se genera exclusivamente en Boda-API a partir de:

- `invitation.id`;
- `displayName`;
- nombres actuales de `guests`.

Cada texto se normaliza con `trim`, minúsculas, eliminación de diacríticos,
conversión de puntuación a espacios y colapso de espacios. Se generan prefijos
de la cadena normalizada completa y de cada palabra. Los prefijos tienen entre
1 y 64 caracteres y cada invitación conserva como máximo 5,000 tokens únicos.
Esto permite buscar tanto `Carlos`/`Carl` como `Martínez`/`Martinez`/`Mart`, y
el código completo o cualquier prefijo natural del código.

Todas las mutaciones que pueden cambiar esos valores recalculan el campo dentro
de la misma escritura o transacción que modifica la invitación.

## Índices Firestore versionados

`Boda/firestore.indexes.json` contiene únicamente las combinaciones compuestas
que añaden filtros al `array-contains` de `searchPrefixes`:

- búsqueda + `rsvpStatus`;
- búsqueda + `isArchived`;
- búsqueda + `rsvpStatus` + `isArchived`.

Las consultas sin búsqueda usan índices automáticos de campo único. El conteo y
la página usan exactamente la misma consulta base. La paginación usa `offset`,
por lo que Firestore factura también las lecturas omitidas; es una solución
deliberadamente sencilla para el volumen actual de cientos de invitaciones y
para conservar total y números de página.

La API conserva 15 como tamaño predeterminado cuando se activa la paginación y
acepta tamaños entre 1 y 100. Omitir tanto `page` como `pageSize` mantiene la
ruta no paginada utilizada por consumidores internos; Boda-Admin envía 15 de
forma explícita.

## Backfill idempotente

No ejecutar contra producción sin autorización explícita. Configurar las
credenciales del proyecto objetivo y revisar primero:

```powershell
npm run backfill:invitation-search -- --dry-run
```

El modo de revisión lee las invitaciones, calcula el valor esperado, compara y
reporta `needsUpdate`, sin escribir. Después de revisar proyecto, credenciales y
resumen, la aplicación autorizada sería:

```powershell
npm run backfill:invitation-search -- --apply
```

El script actualiza únicamente documentos diferentes, completa `isArchived`
con `false` cuando falta y escribe en lotes de hasta 400. Puede repetirse sin
duplicar tokens ni alterar documentos que ya estén actualizados.

## Orden seguro de despliegue futuro

1. Configurar en Boda-API los orígenes públicos y administrativos reales en
   `CORS_ALLOWED_ORIGINS`.
2. Desplegar los índices compuestos y esperar a que Firestore indique que están
   listos.
3. Desplegar Boda-API con el endpoint público y mantenimiento dual del índice;
   mantener todavía las Rules antiguas de escritura pública durante la ventana
   de compatibilidad.
4. Verificar el endpoint en producción con una invitación de prueba y confirmar
   respuestas de éxito, conflicto, cierre y archivo.
5. Ejecutar primero el backfill en `--dry-run`; revisar el proyecto y el resumen.
6. Con autorización independiente, ejecutar `--apply` y repetir `--dry-run`
   hasta obtener `needsUpdate: 0`.
7. Desplegar Boda-Admin con búsqueda y paginación; verificar familia, invitado,
   apellido con/sin acentos, código, filtros y páginas 15/16.
8. Configurar `VITE_API_BASE_URL` y desplegar Boda público. Durante la propagación,
   las Rules antiguas permiten que una versión previa todavía guarde directo.
9. Verificar que el sitio público nuevo guarda mediante Boda-API y que no quedan
   clientes activos escribiendo directamente en Firestore.
10. Desplegar las Rules finales que deniegan create/update/delete públicos.
11. Repetir pruebas de lectura pública y RSVP completo después del cierre.

No se deben invertir los pasos 8–10: cerrar Rules antes de completar la
propagación del frontend público rompería a los clientes que aún ejecuten la
versión anterior.
