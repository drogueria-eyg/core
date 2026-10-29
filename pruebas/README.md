# Pruebas del Core

Se corren desde la raíz del repositorio, con Node:

```
node pruebas/todas.mjs          # todas, una atrás de otra
node pruebas/tasas-por-mes.mjs  # una sola
```

Salen con código 0 si está todo bien y 1 si algo falla, así que sirven para frenar una
publicación.

## Por qué existen

Las pantallas del Core arman su HTML con textos interpolados (`${...}`). Un error ahí —una
variable que no existe, una función que nadie definió— **no lo ve `node --check`**: el archivo
está bien escrito, falla recién cuando alguien abre la pantalla. Eso llegó a producción cuatro
veces en la hoja de liquidación (`data is not defined`, `_freno is not defined`, `fD is not
defined`) y una vez en el panel del comercial (`finMesStr`).

Estas pruebas **ejecutan** las pantallas en vez de leerlas.

## Qué prueba cada una

| archivo | qué hace | necesita Odoo |
|---|---|---|
| `tasas-por-mes.mjs` | que cada mes se calcule con la tasa que regía entonces, y que cambiar una tasa hoy no mueva un mes anterior | no |
| `hoja-liquidacion.mjs` | arma la hoja de liquidación con siete meses de prueba (cerrado, abierto, anterior al paquete, externo sin nivel, con comprobantes excluidos, sin comerciales, y un cierre viejo sin detalle de clientes nuevos) | no |
| `rentabilidad.mjs` | abre la pantalla de rentabilidad comercial con los datos reales y comprueba que los números cierren entre sí | sí |

## La llave del conector

`rentabilidad.mjs` lee Odoo y necesita la llave (ver `eyg-odoo-rpc-candado` en la memoria del
proyecto). La busca en la variable de entorno `EYG_CONNECTOR_KEY` y, si no está, en el archivo
`.eyg-odoo-connector-key` de la carpeta del usuario. **La llave nunca va en el repositorio.**
Si no la encuentra, la prueba avisa y se saltea en vez de fallar.
