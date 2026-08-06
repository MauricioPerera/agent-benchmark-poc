# Reservas — cierre del hallazgo: `last_action` en la observación rompe el loop de `confirm`

## Contexto

Continuación directa de `results/reservations-v1-fix4-validation-20260806/REPORT.md`
y `results/reservations-v1-fix5-validation-20260806/REPORT.md`. Ese hallazgo dejó
establecido que ningún parche de reglas de texto podía cortar el loop de `confirm`
en `modify_conflict` porque `observation()` nunca comunicaba al agente el
resultado de su última acción — un `confirm` redundante devolvía una observación
idéntica a la de un `confirm` exitoso.

## Cambio

`reservations.cjs` agrega `last_action: { action, ok, error?, errorType? }` a
`observation()`, alimentado por `setLastAction()` en cada rama de `step()`
(incluida `finishCase`). Es plomería pura: no se agregó ninguna regla nueva de
texto, solo se conectó el resultado que `step()` ya calculaba (y que antes solo
llegaba a `history` para métricas) a lo que efectivamente ve el agente en el
siguiente turno.

## Resultado (mismos seeds/perfil/presupuesto que las iteraciones previas)

| | `search_required` | `budget_exceeded` | accuracy |
| --- | ---: | ---: | ---: |
| Baseline | 4-6/6 casos | 0/6 corridas | 0-17% |
| Fix 1-4 (reglas de texto) | 0-1/6 | 4-6/6 | 0-33% |
| Fix 5 (`already_confirmed` sin feedback) | 0-1/6 | 6/6 | 0-33% |
| **Fix 6 (`last_action` expuesto)** | 0-1/6 | **0/6** | **16.7-66.7%** |

`budget_exceeded` pasó de 6/6 a **0/6** en las seis combinaciones de modelo y
perfil (`deepseek-v4-pro:cloud`, `gpt-oss:20b-cloud`, `gpt-oss:120b-cloud`;
`standard` y `semantic-ood`). Ningún episodio agotó el presupuesto de acciones.

## Verificación con traza

`reservations-v1-fix6-validation-20260806/trace-deepseek-standard.jsonl` muestra
la secuencia completa del episodio (21 acciones, vs. 30 agotadas antes). En la
reserva `modify_conflict`: `search → create_hold → confirm → inspect_policy →
confirm (redundante) → modify`. El modelo llama a `inspect_policy` (regla ya
existente desde Fix 4), reintenta `confirm` una vez, ve `last_action.error =
"already_confirmed"` y **corrige a `modify`** — sin volver a repetir. En la
reserva `cancel`: `confirm → inspect_policy → cancel`, sin ninguna repetición.

## Conclusión

El bug de fondo no era de contenido de las reglas (regla de "consultar
inspect_policy tras confirm" ya estaba escrita desde Fix 4) sino de plomería:
la señal de éxito/fracaso de la acción anterior nunca llegaba al agente. Una
vez conectada, las reglas de texto ya escritas en iteraciones previas empezaron
a activarse. El hallazgo de Fix 4/5 queda cerrado.

## Limitaciones pendientes (fuera de alcance de este fix)

`stale_version` y `hold_expired` siguen apareciendo (1/6 casos cada uno,
consistente entre corridas) — son escenarios de re-búsqueda tras versión
obsoleta y renovación de hold vencido, no relacionados con el loop de
`confirm`. Quedan como trabajo pendiente aparte. Una repetición por celda; no
hay intervalo de confianza.
