const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
const PUERTO = process.env.PORT || 3000;
const ITBIS = 0.18;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- Utilidades ---------- */

const redondear = (n) => Math.round(n * 100) / 100;

const normalizar = (t) =>
  String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function estadoStock(p) {
  if (p.existencia === 0) return 'AGOTADO';
  if (p.existencia <= p.stock_minimo) return 'STOCK_BAJO';
  return 'DISPONIBLE';
}

function conEstado(p) {
  return { ...p, estado: estadoStock(p), precio_itbis: redondear(p.precio * (1 + ITBIS)) };
}

const numero = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const entero = (v) => { const n = numero(v); return Number.isInteger(n) ? n : NaN; };

function productosActivos(q) {
  const filas = db.prepare(`
    SELECT p.*, c.nombre AS categoria
    FROM producto p JOIN categoria c ON c.id = p.categoria_id
    WHERE p.activo = 1
    ORDER BY p.descripcion
  `).all();
  const lista = filas.map(conEstado);
  const t = normalizar(q);
  if (!t) return lista;
  return lista.filter((p) =>
    normalizar(`${p.codigo} ${p.descripcion} ${p.categoria}`).includes(t)
  );
}

function limpiarProducto(b) {
  const d = {
    codigo: String(b.codigo ?? '').trim(),
    descripcion: String(b.descripcion ?? '').trim(),
    categoria_id: entero(b.categoria_id),
    precio: numero(b.precio),
    existencia: entero(b.existencia),
    stock_minimo: entero(b.stock_minimo),
    pasillo: String(b.pasillo ?? '').trim(),
    estante: String(b.estante ?? '').trim(),
    nivel: String(b.nivel ?? '').trim()
  };
  if (!d.codigo) return { error: 'El código es obligatorio.' };
  if (!d.descripcion) return { error: 'La descripción es obligatoria.' };
  if (!Number.isInteger(d.categoria_id) ||
      !db.prepare('SELECT 1 FROM categoria WHERE id = ?').get(d.categoria_id)) {
    return { error: 'Selecciona una categoría válida.' };
  }
  if (!Number.isFinite(d.precio)) return { error: 'El precio es obligatorio.' };
  if (d.precio < 0) return { error: 'El precio no puede ser negativo.' };
  if (!Number.isInteger(d.existencia)) return { error: 'La existencia debe ser un número entero.' };
  if (d.existencia < 0) return { error: 'La existencia no puede ser negativa.' };
  if (!Number.isInteger(d.stock_minimo)) return { error: 'El stock mínimo debe ser un número entero.' };
  if (d.stock_minimo < 0) return { error: 'El stock mínimo no puede ser negativo.' };
  if (!d.pasillo || !d.estante || !d.nivel) {
    return { error: 'Indica la ubicación completa: pasillo, estante y nivel.' };
  }
  return { datos: d };
}

/* ---------- Inicio (resumen) ---------- */

app.get('/api/resumen', (req, res) => {
  const todos = productosActivos('');
  const aReponer = todos.filter((p) => p.estado !== 'DISPONIBLE');
  res.json({
    productos: todos.length,
    stock_bajo: todos.filter((p) => p.estado === 'STOCK_BAJO').length,
    agotados: todos.filter((p) => p.estado === 'AGOTADO').length,
    categorias: db.prepare('SELECT COUNT(*) AS n FROM categoria').get().n,
    a_reponer: aReponer
  });
});

/* ---------- Categorías (HU-07) ---------- */

const SQL_CATEGORIAS = `
  SELECT c.*, (SELECT COUNT(*) FROM producto p WHERE p.categoria_id = c.id AND p.activo = 1) AS productos
  FROM categoria c ORDER BY c.nombre
`;

function limpiarCategoria(b, idActual) {
  const nombre = String(b.nombre ?? '').trim();
  const descripcion = String(b.descripcion ?? '').trim();
  if (!nombre) return { error: 'El nombre de la categoría es obligatorio.' };
  const repetida = db.prepare('SELECT id FROM categoria WHERE LOWER(nombre) = LOWER(?)').get(nombre);
  if (repetida && repetida.id !== idActual) {
    return { error: 'Ya existe una categoría con ese nombre.' };
  }
  return { datos: { nombre, descripcion } };
}

app.get('/api/categorias', (req, res) => {
  res.json(db.prepare(SQL_CATEGORIAS).all());
});

app.post('/api/categorias', (req, res) => {
  const { datos, error } = limpiarCategoria(req.body, null);
  if (error) return res.status(400).json({ error });
  const id = db.prepare('INSERT INTO categoria (nombre, descripcion) VALUES (?, ?)')
    .run(datos.nombre, datos.descripcion).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM categoria WHERE id = ?').get(id));
});

app.put('/api/categorias/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM categoria WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'La categoría no existe.' });
  }
  const { datos, error } = limpiarCategoria(req.body, id);
  if (error) return res.status(400).json({ error });
  db.prepare('UPDATE categoria SET nombre = ?, descripcion = ? WHERE id = ?')
    .run(datos.nombre, datos.descripcion, id);
  res.json(db.prepare('SELECT * FROM categoria WHERE id = ?').get(id));
});

app.delete('/api/categorias/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM categoria WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'La categoría no existe.' });
  }
  const activos = db.prepare('SELECT COUNT(*) AS n FROM producto WHERE categoria_id = ? AND activo = 1').get(id).n;
  const total = db.prepare('SELECT COUNT(*) AS n FROM producto WHERE categoria_id = ?').get(id).n;
  if (activos > 0) {
    return res.status(409).json({
      error: `No se puede eliminar: la categoría tiene ${activos} producto(s) asociado(s). Muévelos a otra categoría primero.`
    });
  }
  if (total > 0) {
    return res.status(409).json({
      error: 'No se puede eliminar: la categoría tiene productos dados de baja que aún figuran en el historial.'
    });
  }
  db.prepare('DELETE FROM categoria WHERE id = ?').run(id);
  res.json({ ok: true });
});

/* ---------- Productos (HU-06) ---------- */

app.get('/api/productos', (req, res) => {
  res.json(productosActivos(req.query.q));
});

app.post('/api/productos', (req, res) => {
  const { datos: d, error } = limpiarProducto(req.body);
  if (error) return res.status(400).json({ error });
  if (db.prepare('SELECT 1 FROM producto WHERE codigo = ? AND activo = 1').get(d.codigo)) {
    return res.status(409).json({ error: 'Ya existe un producto con ese código.' });
  }
  const id = db.prepare(`INSERT INTO producto
    (codigo, descripcion, categoria_id, precio, existencia, stock_minimo, pasillo, estante, nivel)
    VALUES (@codigo, @descripcion, @categoria_id, @precio, @existencia, @stock_minimo, @pasillo, @estante, @nivel)`)
    .run(d).lastInsertRowid;
  res.status(201).json({ id });
});

app.put('/api/productos/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM producto WHERE id = ? AND activo = 1').get(id)) {
    return res.status(404).json({ error: 'El producto no existe.' });
  }
  const { datos: d, error } = limpiarProducto(req.body);
  if (error) return res.status(400).json({ error });
  const repetido = db.prepare('SELECT id FROM producto WHERE codigo = ? AND activo = 1').get(d.codigo);
  if (repetido && repetido.id !== id) {
    return res.status(409).json({ error: 'Ya existe otro producto con ese código.' });
  }
  db.prepare(`UPDATE producto SET codigo=@codigo, descripcion=@descripcion, categoria_id=@categoria_id,
    precio=@precio, existencia=@existencia, stock_minimo=@stock_minimo,
    pasillo=@pasillo, estante=@estante, nivel=@nivel WHERE id=@id`).run({ ...d, id });
  res.json({ ok: true });
});

// Baja lógica: el producto deja de aparecer, pero se conserva el historial.
app.delete('/api/productos/:id', (req, res) => {
  const cambios = db.prepare('UPDATE producto SET activo = 0 WHERE id = ? AND activo = 1')
    .run(Number(req.params.id)).changes;
  if (!cambios) return res.status(404).json({ error: 'El producto no existe.' });
  res.json({ ok: true });
});

/* ---------- Consulta rápida (HU-04) ---------- */

app.get('/api/buscar', (req, res) => {
  const inicio = process.hrtime.bigint();
  const resultados = String(req.query.q ?? '').trim() ? productosActivos(req.query.q) : [];
  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  res.json({ resultados, ms: redondear(ms) });
});

/* ---------- Recepción de mercancía (HU-02) ---------- */

function cargarOrden(referencia) {
  const orden = db.prepare('SELECT * FROM orden_compra WHERE UPPER(referencia) = UPPER(?)').get(referencia);
  if (!orden) return null;
  const lineas = db.prepare(`
    SELECT d.id AS detalle_id, p.codigo, p.descripcion, d.cantidad_esperada, d.cantidad_recibida,
           (d.cantidad_esperada - d.cantidad_recibida) AS pendiente
    FROM orden_detalle d JOIN producto p ON p.id = d.producto_id
    WHERE d.orden_id = ? ORDER BY d.id
  `).all(orden.id);
  return { ...orden, lineas };
}

app.get('/api/ordenes', (req, res) => {
  const filas = db.prepare(`
    SELECT o.referencia, o.proveedor, o.estado, COUNT(d.id) AS lineas
    FROM orden_compra o LEFT JOIN orden_detalle d ON d.orden_id = o.id
    GROUP BY o.id ORDER BY o.id
  `).all();
  res.json(filas);
});

app.get('/api/ordenes/:referencia', (req, res) => {
  const orden = cargarOrden(req.params.referencia);
  if (!orden) return res.status(404).json({ error: 'No existe una orden de compra con esa referencia.' });
  if (orden.estado === 'RECIBIDA') {
    return res.status(409).json({ error: `La orden ${orden.referencia} ya fue recibida por completo.` });
  }
  res.json(orden);
});

const INCIDENCIAS = ['NINGUNA', 'AVERIA', 'FALTANTE', 'SOBRANTE'];

app.post('/api/recepciones', (req, res) => {
  const orden = cargarOrden(String(req.body.referencia ?? ''));
  if (!orden) return res.status(404).json({ error: 'No existe una orden de compra con esa referencia.' });
  if (orden.estado === 'RECIBIDA') {
    return res.status(409).json({ error: `La orden ${orden.referencia} ya fue recibida por completo.` });
  }

  const entradas = Array.isArray(req.body.lineas) ? req.body.lineas : [];
  const aplicar = [];
  for (const e of entradas) {
    const linea = orden.lineas.find((l) => l.detalle_id === Number(e.detalle_id));
    if (!linea) return res.status(400).json({ error: 'Una de las líneas no pertenece a la orden.' });
    const cantidad = entero(e.cantidad);
    if (!Number.isInteger(cantidad) || cantidad < 0) {
      return res.status(400).json({ error: `La cantidad de "${linea.descripcion}" debe ser un número entero de 0 o más.` });
    }
    let incidencia = INCIDENCIAS.includes(e.incidencia) ? e.incidencia : 'NINGUNA';
    if (incidencia === 'NINGUNA' && cantidad < linea.pendiente) incidencia = 'FALTANTE';
    if (incidencia === 'NINGUNA' && cantidad > linea.pendiente) incidencia = 'SOBRANTE';
    aplicar.push({ linea, cantidad, incidencia, observacion: String(e.observacion ?? '').trim() });
  }
  if (!aplicar.some((a) => a.cantidad > 0)) {
    return res.status(400).json({ error: 'Ingresa al menos una cantidad recibida mayor que 0.' });
  }

  const registrar = db.transaction(() => {
    const prodDeLinea = db.prepare('SELECT producto_id FROM orden_detalle WHERE id = ?');
    for (const a of aplicar) {
      const { producto_id } = prodDeLinea.get(a.linea.detalle_id);
      db.prepare('UPDATE producto SET existencia = existencia + ? WHERE id = ?').run(a.cantidad, producto_id);
      db.prepare('UPDATE orden_detalle SET cantidad_recibida = cantidad_recibida + ? WHERE id = ?')
        .run(a.cantidad, a.linea.detalle_id);
      db.prepare(`INSERT INTO recepcion (orden_id, producto_id, cantidad, incidencia, observacion)
        VALUES (?, ?, ?, ?, ?)`).run(orden.id, producto_id, a.cantidad, a.incidencia, a.observacion);
    }
    const faltan = db.prepare(
      'SELECT COUNT(*) AS n FROM orden_detalle WHERE orden_id = ? AND cantidad_recibida < cantidad_esperada'
    ).get(orden.id).n;
    const estado = faltan === 0 ? 'RECIBIDA' : 'PARCIAL';
    db.prepare('UPDATE orden_compra SET estado = ? WHERE id = ?').run(estado, orden.id);
    return estado;
  });

  const estado = registrar();
  res.status(201).json({ referencia: orden.referencia, estado });
});

app.get('/api/recepciones', (req, res) => {
  res.json(db.prepare(`
    SELECT r.id, r.fecha, o.referencia, p.codigo, p.descripcion, r.cantidad, r.incidencia, r.observacion
    FROM recepcion r
    JOIN orden_compra o ON o.id = r.orden_id
    JOIN producto p ON p.id = r.producto_id
    ORDER BY r.id DESC LIMIT 15
  `).all());
});

/* ---------- Errores y arranque ---------- */

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Ocurrió un error en el servidor. Intenta de nuevo.' });
});

app.listen(PUERTO, () => {
  console.log(`SGIF listo en http://localhost:${PUERTO}`);
});
