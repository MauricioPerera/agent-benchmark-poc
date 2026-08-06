# Protocolo de evaluación v1

## Objetivo

Comparar agentes mediante el mismo conjunto de episodios, herramientas y
presupuesto. La velocidad se reporta por separado de la calidad.

## Configuración congelada

| Dominio | Perfil | Semillas | Repeticiones | Casos | Máximo de acciones | Timeout por acción |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| Frontera | `standard` | 51000–51004 | 3 | 3 | 18 | 30 s |
| Frontera | `interactive-semantic-ood` | 51100–51104 | 3 | 2 | 18 | 30 s |
| Soporte | estándar | 51200–51204 | 3 | 6 | 30 | 30 s |
| Reservas | `standard` | 51300–51304 | 3 | 6 | 30 | 30 s |
| Reservas | `semantic-ood` | 51400–51404 | 3 | 6 | 30 | 30 s |

Los modelos deben usar exactamente la misma fila del protocolo. Si una llamada
agota el timeout, se registra como timeout del modelo y no como una decisión
incorrecta.

## Métricas primarias

- éxito completo de episodio y su intervalo Wilson del 95%;
- `pass^k` por semilla;
- precisión, errores críticos y score;
- errores de herramienta, protocolo, timeout, parseo y presupuesto;
- latencia media, p50 y p95;
- matrices de confusión y macro-F1, globales y por escenario.

## Reglas de interpretación

- No comparar resultados si las semillas, perfiles o presupuestos difieren.
- No convertir latencia de proveedor/red en una conclusión de razonamiento.
- Un acierto final con errores operativos no equivale a éxito completo.
- Publicar los JSONL, configuración, versión del generador y fecha de la corrida.
