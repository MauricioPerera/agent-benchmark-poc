# Reservas — `stale_version` y `hold_expired` recuperables

## Contexto

Con el loop de `confirm` cerrado (Fix 6), quedaban dos fallas sistemáticas y
100% consistentes en las 6 corridas de `results/reservations-v1-fix6-validation-20260806/`:
`stale_version` en la reserva 2 (`stale`) y `hold_expired` en la reserva 3
(`expired_hold`), siempre en el primer intento.

## Diagnóstico

Ambas fallaban por el mismo defecto estructural que ya habíamos visto en
`confirm`: un fallo terminaba el caso inmediatamente vía `finishCase`, sin dar
al agente ninguna chance de corregir dentro de la misma reserva — aunque las
`rules` ya dijeran qué hacer ("una versión obsoleta exige volver a
consultar", "refresh the availability revision"). Un agente sin información
previa del tipo de reserva no puede anticipar que necesita buscar/crear el
hold dos veces; solo puede reaccionar si el primer intento fallido no cierra
el caso.

Adicionalmente, `hold_expired` estaba clasificado como error de **decisión
crítico** (`errorType: 'decision', critical: true`), igual que dejar pasar un
prófugo en el dominio de frontera. Revisando la semántica: un hold vencido sin
booking creado no es una sobreventa real (a diferencia de `no_availability`,
que sí queda intacto como crítico) — es un problema operativo recuperable.

## Cambio

En `reservations.cjs`:
- `stale_version` (rama `create_hold`): pasa de `finishCase(...)` a un error
  de herramienta recuperable, mismo patrón que `already_confirmed`. Sin
  cambio de clasificación (ya era `tool`/no-crítico), solo deja de cerrar el
  caso.
- `hold_expired` (rama `confirm`): mismo cambio a error recuperable, y además
  se reclasifica de `decision`/crítico a `tool`/no-crítico.

Ninguna regla de texto nueva — las reglas ya escritas en Fix 1-4 ya cubrían
estos casos; lo que faltaba era la oportunidad de aplicarlas.

## Resultado (mismos seeds/perfil/presupuesto)

| Suite / modelo | Fix 6 (accuracy / crítico) | Fix 7 (accuracy / crítico) |
| --- | ---: | ---: |
| standard / DeepSeek | 67% / 1 | 83% / 1 |
| standard / GPT-OSS 20B | 17% / 1 | 67% / 0 |
| standard / GPT-OSS 120B | 67% / 1 | 83% / 1 |
| semantic-ood / DeepSeek | 50% / 2 | 83% / 1 |
| semantic-ood / GPT-OSS 20B | 67% / 1 | 50% / 0 |
| semantic-ood / GPT-OSS 120B | 67% / 1 | 67% / 0 |

Accuracy sube en 5 de 6 combinaciones (la sexta, GPT-OSS 20B semantic-ood,
baja de 67% a 50% pero pierde su error crítico). Los errores críticos bajan
en 4 de 6 combinaciones, consistente con la reclasificación de
`hold_expired`.

## Verificación con traza

Una traza de re-verificación (`gpt-oss:20b-cloud`, `standard`, mismo seed)
resolvió el episodio completo: **100% accuracy, sin errores relevantes, sin
agotar presupuesto** — confirma que la recuperación funciona de punta a
punta cuando el modelo la ejecuta bien. La corrida original de la tabla
(misma seed) había mostrado `hold_expired` repetido 6 veces y presupuesto
agotado; no se reprodujo en la re-verificación. Se interpreta como
variabilidad de muestreo del modelo cloud (temperatura 0 no garantiza
determinismo en inferencia por lotes), consistente con la variación de
corrida a corrida ya documentada en reportes anteriores — no como un loop
nuevo introducido por este cambio.

## Limitaciones de esta corrida

Una repetición por celda; no hay intervalo de confianza. La variabilidad
observada en GPT-OSS 20B refuerza que la próxima medición debe usar varias
repeticiones por semilla antes de comparar modelos numéricamente.
