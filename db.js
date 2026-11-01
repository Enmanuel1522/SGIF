const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'sgif.db'));
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS categoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE,
  descripcion TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS producto (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  categoria_id INTEGER NOT NULL REFERENCES categoria(id),
  precio REAL NOT NULL CHECK (precio >= 0),
  existencia INTEGER NOT NULL CHECK (existencia >= 0),
  stock_minimo INTEGER NOT NULL CHECK (stock_minimo >= 0),
  pasillo TEXT NOT NULL,
  estante TEXT NOT NULL,
  nivel TEXT NOT NULL,
  activo INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_codigo_activo ON producto(codigo) WHERE activo = 1;
CREATE INDEX IF NOT EXISTS ix_producto_descripcion ON producto(descripcion);

CREATE TABLE IF NOT EXISTS orden_compra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referencia TEXT NOT NULL UNIQUE,
  proveedor TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'APROBADA' CHECK (estado IN ('APROBADA','PARCIAL','RECIBIDA'))
);

CREATE TABLE IF NOT EXISTS orden_detalle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id INTEGER NOT NULL REFERENCES orden_compra(id),
  producto_id INTEGER NOT NULL REFERENCES producto(id),
  cantidad_esperada INTEGER NOT NULL CHECK (cantidad_esperada > 0),
  cantidad_recibida INTEGER NOT NULL DEFAULT 0 CHECK (cantidad_recibida >= 0)
);

CREATE TABLE IF NOT EXISTS recepcion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orden_id INTEGER NOT NULL REFERENCES orden_compra(id),
  producto_id INTEGER NOT NULL REFERENCES producto(id),
  cantidad INTEGER NOT NULL CHECK (cantidad >= 0),
  incidencia TEXT NOT NULL DEFAULT 'NINGUNA' CHECK (incidencia IN ('NINGUNA','AVERIA','FALTANTE','SOBRANTE')),
  observacion TEXT NOT NULL DEFAULT '',
  fecha TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

function sembrarDatosDeEjemplo() {
  const hayDatos = db.prepare('SELECT COUNT(*) AS n FROM categoria').get().n > 0;
  if (hayDatos) return;

  const insCat = db.prepare('INSERT INTO categoria (nombre, descripcion) VALUES (?, ?)');
  const cats = {};
  [
    ['Tornillería', 'Tornillos, clavos, tuercas y anclajes'],
    ['Herramientas manuales', 'Llaves, martillos, alicates y destornilladores'],
    ['Plomería', 'Tuberías, conexiones y accesorios de agua'],
    ['Electricidad', 'Cables, breakers, tomacorrientes y bombillos'],
    ['Pinturas', 'Pinturas, brochas y accesorios'],
    ['Construcción', 'Cemento, varillas y materiales de obra']
  ].forEach(([n, d]) => { cats[n] = insCat.run(n, d).lastInsertRowid; });

  const insProd = db.prepare(`INSERT INTO producto
    (codigo, descripcion, categoria_id, precio, existencia, stock_minimo, pasillo, estante, nivel)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const prods = {};
  [
    ['TOR-001', 'Tornillo 1/4 x 2" (caja)', 'Tornillería', 150, 85, 20, '1', 'A', '1'],
    ['TOR-002', 'Clavos de 2 pulgadas (libra)', 'Tornillería', 45, 200, 50, '1', 'A', '2'],
    ['TOR-003', 'Tuerca hexagonal 3/8 (paquete)', 'Tornillería', 95, 8, 15, '1', 'B', '1'],
    ['HER-001', 'Llave ajustable 10"', 'Herramientas manuales', 620, 14, 5, '2', 'A', '2'],
    ['HER-002', 'Martillo de uña 16 oz', 'Herramientas manuales', 480, 22, 6, '2', 'A', '1'],
    ['HER-003', 'Destornillador plano 6"', 'Herramientas manuales', 130, 3, 10, '2', 'B', '1'],
    ['CON-001', 'Cemento gris 42.5 kg', 'Construcción', 495, 120, 30, '3', 'B', '2'],
    ['CON-002', 'Cemento blanco 40 kg', 'Construcción', 700, 4, 10, '3', 'B', '3'],
    ['CON-003', 'Cemento rápido 25 kg', 'Construcción', 550, 0, 8, '3', 'C', '1'],
    ['CON-004', 'Varilla 3/8 x 20 pies', 'Construcción', 385, 60, 25, '4', 'A', '1'],
    ['PLO-001', 'Tubo PVC 1/2 pulgada x 10 pies', 'Plomería', 210, 45, 15, '5', 'A', '1'],
    ['PLO-002', 'Codo PVC 1/2 pulgada', 'Plomería', 18, 160, 40, '5', 'A', '2'],
    ['ELE-001', 'Cable THHN #12 (rollo 100 pies)', 'Electricidad', 2350, 12, 4, '6', 'A', '1'],
    ['ELE-002', 'Tomacorriente doble blanco', 'Electricidad', 95, 5, 12, '6', 'B', '2'],
    ['PIN-001', 'Pintura blanca 1 galón', 'Pinturas', 1250, 18, 6, '7', 'A', '1'],
    ['PIN-002', 'Brocha de 3 pulgadas', 'Pinturas', 160, 25, 8, '7', 'B', '1']
  ].forEach(([codigo, desc, cat, precio, exist, min, pas, est, niv]) => {
    prods[codigo] = insProd.run(codigo, desc, cats[cat], precio, exist, min, pas, est, niv).lastInsertRowid;
  });

  const insOrden = db.prepare('INSERT INTO orden_compra (referencia, proveedor) VALUES (?, ?)');
  const insDet = db.prepare('INSERT INTO orden_detalle (orden_id, producto_id, cantidad_esperada) VALUES (?, ?, ?)');
  const ordenes = [
    ['OC-1001', 'Distribuidora Cibao', [['CON-002', 30], ['CON-003', 20]]],
    ['OC-1002', 'Importadora Herramientas del Este', [['HER-001', 15], ['HER-003', 25], ['TOR-003', 30]]],
    ['OC-1003', 'Eléctrica Nacional', [['ELE-002', 40], ['ELE-001', 6]]]
  ];
  ordenes.forEach(([ref, prov, lineas]) => {
    const id = insOrden.run(ref, prov).lastInsertRowid;
    lineas.forEach(([cod, cant]) => insDet.run(id, prods[cod], cant));
  });
}

sembrarDatosDeEjemplo();

module.exports = db;
