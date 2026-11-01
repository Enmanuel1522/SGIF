# SGIF · Sistema de Gestión de Inventario Ferretero (Sprint 1)

Incremento funcional del Sprint 1 para **Ferretería Americana**. Es una aplicación web con base de datos real (SQLite) y API REST. Corre en la computadora de cada integrante, sin internet.

## Cómo ejecutarlo

Requisito: **Node.js 20 o más nuevo** (descárgalo en nodejs.org, versión LTS).

**Windows:** haz doble clic en `iniciar.bat`. Instala lo necesario la primera vez y abre el navegador.

**Cualquier sistema (terminal):**

```
npm install
npm start
```

Luego abre http://localhost:3000. Para detener el servidor, presiona `Ctrl + C`.

La primera vez se crea el archivo `sgif.db` con datos de ejemplo (16 productos, 6 categorías y 3 órdenes de compra), así que la demo nunca empieza vacía.

**Volver a los datos iniciales** (por ejemplo, antes de grabar el video o de la presentación en clase):

```
npm run reset
npm start
```

## Qué incluye (historias del Sprint 1)

| Historia | Pantalla | Qué se puede hacer |
|---|---|---|
| HU-06 CRUD de productos | Productos | Crear, listar, buscar, editar y eliminar productos. No acepta códigos repetidos ni precios o cantidades negativas. |
| HU-07 CRUD de categorías | Categorías | Crear, editar y eliminar categorías. No deja eliminar una categoría que tiene productos. |
| HU-04 Consulta rápida | Consulta rápida | Busca por código, descripción o categoría y muestra existencia, precio con ITBIS (18 %), ubicación y semáforo de stock (Disponible, Stock bajo, Agotado). |
| HU-02 Recepción de mercancía | Recepción de mercancía | Busca una orden de compra, registra lo recibido, clasifica diferencias (avería, faltante, sobrante), actualiza el inventario y cambia la orden a PARCIAL o RECIBIDA. |

La pantalla **Inicio** muestra cuántos productos hay con stock bajo o agotados y la lista de lo que hay que reponer.

## Guion sugerido para la demostración (5 a 6 minutos)

1. **Inicio:** mostrar los indicadores y los productos por reponer (hay uno agotado y varios con stock bajo).
2. **Productos (HU-06):** crear un producto nuevo, intentar repetir su código (muestra el error), editarlo y eliminarlo.
3. **Categorías (HU-07):** crear una categoría, intentar eliminar «Plomería» (se bloquea porque tiene productos) y eliminar la categoría nueva.
4. **Consulta rápida (HU-04):** buscar «cemento» y mostrar el semáforo, el precio con ITBIS y la ubicación.
5. **Recepción (HU-02):** abrir la orden OC-1001, recibir una cantidad menor a la esperada (queda PARCIAL con incidencia de faltante), volver a recibir lo pendiente (queda RECIBIDA).
6. **Cierre:** volver a la Consulta rápida y buscar «cemento»: el cemento rápido ya no está agotado. Esto muestra la idea central del sistema, que el inventario se mantiene al día.

## Estructura del proyecto

```
server.js          API REST (Express)
db.js              Tablas de la base de datos y datos de ejemplo
public/index.html  Estructura de la página
public/styles.css  Estilos (paleta y reglas de la guía de estilo del equipo)
public/app.js      Pantallas y conexión con la API
```

## Si algo falla

- **`npm install` da error:** revisa que tengas Node.js 20 o más nuevo (`node -v`).
- **El puerto 3000 está ocupado:** cierra la otra ventana del servidor, o ejecuta `set PORT=3001 && npm start` (Windows) y abre http://localhost:3001.
- **Quiero empezar de cero:** `npm run reset`.
