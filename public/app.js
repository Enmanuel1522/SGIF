
const $ = (sel, el = document) => el.querySelector(sel);
const vista = $('#vista');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const dinero = (n) =>
  'RD$ ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function retardo(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function api(url, opciones = {}) {
  const respuesta = await fetch(url, {
    method: opciones.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined
  });
  let datos = null;
  try { datos = await respuesta.json(); } catch (e) { /* sin cuerpo */ }
  if (!respuesta.ok) throw new Error((datos && datos.error) || 'Ocurrió un error. Intenta de nuevo.');
  return datos;
}

/* ---------- Avisos y confirmaciones ---------- */

let temporizadorAviso;
function aviso(texto, tipo = '') {
  const el = $('#aviso');
  el.textContent = texto;
  el.className = tipo === 'error' ? 'error-aviso' : tipo === 'ok' ? 'ok-aviso' : '';
  el.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.hidden = true; }, 4500);
}

function mostrarError(selector, texto) {
  const el = $(selector);
  el.textContent = texto;
  el.hidden = false;
}

function confirmar(titulo, texto) {
  return new Promise((resolver) => {
    const dlg = $('#dlgConfirmar');
    $('#tituloConfirmar').textContent = titulo;
    $('#textoConfirmar').textContent = texto;
    dlg.returnValue = '';
    dlg.addEventListener('close', () => resolver(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}

document.addEventListener('click', (e) => {
  if (e.target.matches('[data-cerrar]')) e.target.closest('dialog').close();
});

/* ---------- Estados de stock ---------- */

const ESTADOS = {
  DISPONIBLE: { clase: 'ok', texto: 'Disponible', fila: '' },
  STOCK_BAJO: { clase: 'warn', texto: 'Stock bajo', fila: 'fila-bajo' },
  AGOTADO: { clase: 'bad', texto: 'Agotado', fila: 'fila-agotado' }
};
const etiquetaEstado = (estado) =>
  `<span class="badge ${ESTADOS[estado].clase}">${ESTADOS[estado].texto}</span>`;
const ubicacionCorta = (p) => `${esc(p.pasillo)} · ${esc(p.estante)} · ${esc(p.nivel)}`;
const ubicacion = (p) => `Pasillo ${esc(p.pasillo)} · Estante ${esc(p.estante)} · Nivel ${esc(p.nivel)}`;

const INCIDENCIAS = { NINGUNA: 'Sin incidencia', AVERIA: 'Avería', FALTANTE: 'Faltante', SOBRANTE: 'Sobrante' };
const formatoFecha = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)} ${f.slice(11, 16)}`;

/* ---------- Navegación ---------- */

let refrescarVista = () => {};

const VISTAS = {
  inicio: vistaInicio,
  productos: vistaProductos,
  categorias: vistaCategorias,
  consulta: vistaConsulta,
  recepcion: vistaRecepcion
};

async function router() {
  const ruta = location.hash.replace('#/', '') || 'inicio';
  const nombre = VISTAS[ruta] ? ruta : 'inicio';
  document.querySelectorAll('.menu a').forEach((a) => {
    const activo = a.dataset.ruta === nombre;
    a.classList.toggle('activo', activo);
    if (activo) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  refrescarVista = () => {};
  $('#aviso').hidden = true;
  try {
    await VISTAS[nombre]();
  } catch (err) {
    vista.innerHTML = `<p class="error">No se pudo cargar la información. Revisa que el servidor esté encendido. (${esc(err.message)})</p>`;
  }
}
window.addEventListener('hashchange', router);

/* ---------- Inicio ---------- */

async function vistaInicio() {
  const r = await api('/api/resumen');
  const filas = r.a_reponer.map((p) => `
    <tr class="${ESTADOS[p.estado].fila}">
      <td class="codigo">${esc(p.codigo)}</td>
      <td>${esc(p.descripcion)}</td>
      <td class="num">${p.existencia}</td>
      <td class="num">${p.stock_minimo}</td>
      <td>${etiquetaEstado(p.estado)}</td>
      <td>${ubicacion(p)}</td>
    </tr>`).join('');

  vista.innerHTML = `
    <div class="cabecera">
      <div>
        <h1>Inicio</h1>
        <p class="subtitulo">El estado del inventario de Ferretería Americana de un vistazo.</p>
      </div>
      <a class="btn primario" href="#/recepcion">Registrar recepción</a>
    </div>
    <div class="indicadores">
      <div class="indicador"><div class="valor">${r.productos}</div><div class="etiqueta">Productos en inventario</div></div>
      <div class="indicador bajo"><div class="valor">${r.stock_bajo}</div><div class="etiqueta">Con stock bajo</div></div>
      <div class="indicador agotado"><div class="valor">${r.agotados}</div><div class="etiqueta">Agotados</div></div>
      <div class="indicador ok"><div class="valor">${r.categorias}</div><div class="etiqueta">Categorías</div></div>
    </div>
    <h2>Productos que hay que reponer</h2>
    ${r.a_reponer.length ? `
      <div class="tabla-caja"><table>
        <thead><tr><th>Código</th><th>Descripción</th><th class="num">Existencia</th><th class="num">Mínimo</th><th>Estado</th><th>Ubicación</th></tr></thead>
        <tbody>${filas}</tbody>
      </table></div>` : `<div class="tabla-caja"><p class="vacio">Todos los productos están por encima de su stock mínimo.</p></div>`}
  `;
}

/* ---------- Productos (CRUD) ---------- */

let productoEditando = null;
const CAMPOS_PRODUCTO = ['codigo', 'descripcion', 'categoria_id', 'precio', 'existencia', 'stock_minimo', 'pasillo', 'estante', 'nivel'];

async function abrirProducto(prod) {
  const categorias = await api('/api/categorias');
  if (!categorias.length) {
    aviso('Primero crea una categoría para poder registrar productos.', 'error');
    return;
  }
  const f = $('#formProducto');
  f.reset();
  f.categoria_id.innerHTML = categorias.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  productoEditando = prod ? prod.id : null;
  $('#tituloProducto').textContent = prod ? 'Editar producto' : 'Nuevo producto';
  if (prod) CAMPOS_PRODUCTO.forEach((k) => { f[k].value = prod[k]; });
  $('#errProducto').hidden = true;
  $('#dlgProducto').showModal();
  f.codigo.focus();
}

$('#formProducto').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cuerpo = Object.fromEntries(new FormData(e.target));
  const editando = productoEditando;
  try {
    await api(editando ? `/api/productos/${editando}` : '/api/productos', {
      method: editando ? 'PUT' : 'POST',
      body: cuerpo
    });
    $('#dlgProducto').close();
    aviso(editando ? 'Producto actualizado.' : 'Producto creado.', 'ok');
    refrescarVista();
  } catch (err) {
    mostrarError('#errProducto', err.message);
  }
});

async function vistaProductos() {
  vista.innerHTML = `
    <div class="cabecera">
      <div>
        <h1>Productos</h1>
        <p class="subtitulo">Crea, edita y elimina los productos del inventario.</p>
      </div>
    </div>
    <div class="barra">
      <input id="q" class="buscador" type="search" placeholder="Buscar por código, descripción o categoría…" aria-label="Buscar productos" autocomplete="off">
      <button id="btnNuevo" class="btn primario">Nuevo producto</button>
    </div>
    <div id="lista"></div>
  `;
  let lista = [];

  const cargar = async () => {
    const q = $('#q').value.trim();
    lista = await api('/api/productos?q=' + encodeURIComponent(q));
    if (!lista.length) {
      $('#lista').innerHTML = `<div class="tabla-caja"><p class="vacio">${
        q ? `No hay productos que coincidan con «${esc(q)}».` : 'Todavía no hay productos. Crea el primero con «Nuevo producto».'
      }</p></div>`;
      return;
    }
    $('#lista').innerHTML = `
      <div class="tabla-caja compacta"><table>
        <thead><tr>
          <th>Producto</th><th class="num">Precio</th>
          <th class="num">Existencia</th><th class="num">Mínimo</th><th>Ubicación<br><span class="tenue">pasillo · estante · nivel</span></th><th>Estado</th><th>Acciones</th>
        </tr></thead>
        <tbody>${lista.map((p) => `
          <tr class="${ESTADOS[p.estado].fila}">
            <td><span class="codigo">${esc(p.codigo)}</span> · ${esc(p.descripcion)}<br><span class="tenue">${esc(p.categoria)}</span></td>
            <td class="num">${dinero(p.precio)}</td>
            <td class="num">${p.existencia}</td>
            <td class="num">${p.stock_minimo}</td>
            <td class="nowrap">${ubicacionCorta(p)}</td>
            <td>${etiquetaEstado(p.estado)}</td>
            <td><div class="acciones-fila">
              <button class="btn secundario pequeno" data-accion="editar" data-id="${p.id}">Editar</button>
              <button class="btn secundario pequeno" data-accion="eliminar" data-id="${p.id}">Eliminar</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  };

  refrescarVista = cargar;
  $('#q').addEventListener('input', retardo(cargar, 200));
  $('#btnNuevo').addEventListener('click', () => abrirProducto(null));
  $('#lista').addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const p = lista.find((x) => x.id === Number(boton.dataset.id));
    if (!p) return;
    if (boton.dataset.accion === 'editar') return abrirProducto(p);
    const si = await confirmar('¿Eliminar producto?', `Se eliminará «${p.descripcion}» (${p.codigo}) del inventario.`);
    if (!si) return;
    try {
      await api(`/api/productos/${p.id}`, { method: 'DELETE' });
      aviso('Producto eliminado.', 'ok');
      cargar();
    } catch (err) {
      aviso(err.message, 'error');
    }
  });
  await cargar();
}

/* ---------- Categorías (CRUD) ---------- */

let categoriaEditando = null;

function abrirCategoria(cat) {
  const f = $('#formCategoria');
  f.reset();
  categoriaEditando = cat ? cat.id : null;
  $('#tituloCategoria').textContent = cat ? 'Editar categoría' : 'Nueva categoría';
  if (cat) { f.nombre.value = cat.nombre; f.descripcion.value = cat.descripcion; }
  $('#errCategoria').hidden = true;
  $('#dlgCategoria').showModal();
  f.nombre.focus();
}

$('#formCategoria').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cuerpo = Object.fromEntries(new FormData(e.target));
  const editando = categoriaEditando;
  try {
    await api(editando ? `/api/categorias/${editando}` : '/api/categorias', {
      method: editando ? 'PUT' : 'POST',
      body: cuerpo
    });
    $('#dlgCategoria').close();
    aviso(editando ? 'Categoría actualizada.' : 'Categoría creada.', 'ok');
    refrescarVista();
  } catch (err) {
    mostrarError('#errCategoria', err.message);
  }
});

async function vistaCategorias() {
  vista.innerHTML = `
    <div class="cabecera">
      <div>
        <h1>Categorías</h1>
        <p class="subtitulo">Organiza los productos por tipo para encontrarlos más rápido.</p>
      </div>
      <button id="btnNueva" class="btn primario">Nueva categoría</button>
    </div>
    <div id="lista"></div>
  `;
  let lista = [];

  const cargar = async () => {
    lista = await api('/api/categorias');
    if (!lista.length) {
      $('#lista').innerHTML = `<div class="tabla-caja"><p class="vacio">Todavía no hay categorías. Crea la primera con «Nueva categoría».</p></div>`;
      return;
    }
    $('#lista').innerHTML = `
      <div class="tabla-caja"><table>
        <thead><tr><th>Nombre</th><th>Descripción</th><th class="num">Productos</th><th>Acciones</th></tr></thead>
        <tbody>${lista.map((c) => `
          <tr>
            <td class="codigo">${esc(c.nombre)}</td>
            <td>${esc(c.descripcion) || '<span class="tenue">Sin descripción</span>'}</td>
            <td class="num">${c.productos}</td>
            <td><div class="acciones-fila">
              <button class="btn secundario pequeno" data-accion="editar" data-id="${c.id}">Editar</button>
              <button class="btn secundario pequeno" data-accion="eliminar" data-id="${c.id}">Eliminar</button>
            </div></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  };

  refrescarVista = cargar;
  $('#btnNueva').addEventListener('click', () => abrirCategoria(null));
  $('#lista').addEventListener('click', async (e) => {
    const boton = e.target.closest('[data-accion]');
    if (!boton) return;
    const c = lista.find((x) => x.id === Number(boton.dataset.id));
    if (!c) return;
    if (boton.dataset.accion === 'editar') return abrirCategoria(c);
    const si = await confirmar('¿Eliminar categoría?', `Se eliminará la categoría «${c.nombre}».`);
    if (!si) return;
    try {
      await api(`/api/categorias/${c.id}`, { method: 'DELETE' });
      aviso('Categoría eliminada.', 'ok');
      cargar();
    } catch (err) {
      aviso(err.message, 'error');
    }
  });
  await cargar();
}

/* ---------- Consulta rápida ---------- */

async function vistaConsulta() {
  vista.innerHTML = `
    <div class="cabecera">
      <div>
        <h1>Consulta rápida</h1>
        <p class="subtitulo">Mira la existencia, el precio con ITBIS y la ubicación sin ir a la bodega.</p>
      </div>
    </div>
    <input id="q" class="buscador grande" type="search" autocomplete="off"
           placeholder="Escribe un código, una descripción o una categoría…" aria-label="Buscar productos">
    <div id="resultado"></div>
  `;
  const pista = `<div class="tabla-caja" style="margin-top:16px"><p class="vacio">Empieza a escribir para ver resultados. Por ejemplo: <strong>cemento</strong>.</p></div>`;
  $('#resultado').innerHTML = pista;
  $('#q').focus();

  let ultima = 0;
  const buscar = async () => {
    const q = $('#q').value.trim();
    const turno = ++ultima;
    if (!q) { $('#resultado').innerHTML = pista; return; }
    const t0 = performance.now();
    const datos = await api('/api/buscar?q=' + encodeURIComponent(q));
    if (turno !== ultima) return;
    const segundos = ((performance.now() - t0) / 1000).toFixed(2);
    const n = datos.resultados.length;
    if (!n) {
      $('#resultado').innerHTML = `<div class="tabla-caja" style="margin-top:16px"><p class="vacio">No encontramos productos con «${esc(q)}». Prueba con otro código o con la categoría.</p></div>`;
      return;
    }
    $('#resultado').innerHTML = `
      <p class="info-busqueda">${n} ${n === 1 ? 'resultado' : 'resultados'} · ${segundos} s</p>
      <div class="tabla-caja"><table>
        <thead><tr><th>Producto</th><th>Categoría</th><th class="num">Precio con ITBIS (18 %)</th><th class="num">Existencia</th><th>Estado</th><th>Ubicación</th></tr></thead>
        <tbody>${datos.resultados.map((p) => `
          <tr class="${ESTADOS[p.estado].fila}">
            <td><span class="codigo">${esc(p.codigo)}</span><br>${esc(p.descripcion)}</td>
            <td>${esc(p.categoria)}</td>
            <td class="num">${dinero(p.precio_itbis)}</td>
            <td class="num">${p.existencia}</td>
            <td>${etiquetaEstado(p.estado)}</td>
            <td>${ubicacion(p)}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;
  };
  refrescarVista = buscar;
  $('#q').addEventListener('input', retardo(buscar, 150));
}

/* ---------- Recepción de mercancía ---------- */

let mensajeRecepcion = '';
const ESTADOS_ORDEN = { APROBADA: ['neutro', 'Aprobada'], PARCIAL: ['warn', 'Parcial'], RECIBIDA: ['ok', 'Recibida'] };
const etiquetaOrden = (estado) =>
  `<span class="badge ${ESTADOS_ORDEN[estado][0]}">${ESTADOS_ORDEN[estado][1]}</span>`;

async function vistaRecepcion() {
  const [ordenes, historial] = await Promise.all([api('/api/ordenes'), api('/api/recepciones')]);
  const pendientes = ordenes.filter((o) => o.estado !== 'RECIBIDA');

  vista.innerHTML = `
    <div class="cabecera">
      <div>
        <h1>Recepción de mercancía</h1>
        <p class="subtitulo">Registra lo que llega de una orden de compra y reporta las diferencias.</p>
      </div>
    </div>
    ${mensajeRecepcion ? `<div class="resultado" role="status">${esc(mensajeRecepcion)}</div>` : ''}
    <div class="barra">
      <input id="ref" class="buscador" autocomplete="off" placeholder="Número de la orden. Ejemplo: OC-1001" aria-label="Número de la orden de compra">
      <button id="btnOrden" class="btn primario">Buscar orden</button>
    </div>
    <div class="ordenes">${pendientes.length ? pendientes.map((o) => `
      <button class="chip" data-ref="${esc(o.referencia)}">
        <strong>${esc(o.referencia)}</strong> ${etiquetaOrden(o.estado)}<br>
        <span class="tenue">${esc(o.proveedor)} · ${o.lineas} ${o.lineas === 1 ? 'producto' : 'productos'}</span>
      </button>`).join('') : '<p class="tenue">No hay órdenes pendientes de recibir.</p>'}
    </div>
    <div id="panelOrden"></div>
    <h2>Últimas recepciones</h2>
    ${historial.length ? `
      <div class="tabla-caja"><table>
        <thead><tr><th>Fecha</th><th>Orden</th><th>Producto</th><th class="num">Cantidad</th><th>Incidencia</th><th>Observación</th></tr></thead>
        <tbody>${historial.map((h) => `
          <tr>
            <td>${formatoFecha(h.fecha)}</td>
            <td class="codigo">${esc(h.referencia)}</td>
            <td><span class="codigo">${esc(h.codigo)}</span> ${esc(h.descripcion)}</td>
            <td class="num">${h.cantidad}</td>
            <td>${h.incidencia === 'NINGUNA' ? '<span class="tenue">Sin incidencia</span>' : `<span class="badge warn">${INCIDENCIAS[h.incidencia]}</span>`}</td>
            <td>${esc(h.observacion) || '<span class="tenue">—</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `<div class="tabla-caja"><p class="vacio">Aún no se ha recibido mercancía.</p></div>`}
  `;
  mensajeRecepcion = '';
  refrescarVista = vistaRecepcion;

  const buscarOrden = async (ref) => {
    const referencia = ref.trim();
    if (!referencia) { $('#panelOrden').innerHTML = ''; return aviso('Escribe el número de la orden.', 'error'); }
    try {
      const orden = await api('/api/ordenes/' + encodeURIComponent(referencia));
      pintarOrden(orden);
    } catch (err) {
      $('#panelOrden').innerHTML = `<p class="error">${esc(err.message)}</p>`;
    }
  };
  $('#btnOrden').addEventListener('click', () => buscarOrden($('#ref').value));
  $('#ref').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarOrden($('#ref').value); });
  document.querySelectorAll('.chip').forEach((c) =>
    c.addEventListener('click', () => { $('#ref').value = c.dataset.ref; buscarOrden(c.dataset.ref); }));
}

function pintarOrden(orden) {
  const opciones = Object.entries(INCIDENCIAS).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  const lineas = orden.lineas.filter((l) => l.pendiente > 0 || orden.estado !== 'RECIBIDA');
  $('#panelOrden').innerHTML = `
    <div class="panel">
      <h2>Orden ${esc(orden.referencia)} · ${esc(orden.proveedor)} ${etiquetaOrden(orden.estado)}</h2>
      <div class="tabla-caja" style="border:none"><table>
        <thead><tr><th>Producto</th><th class="num">Esperada</th><th class="num">Ya recibida</th><th class="num">Pendiente</th>
        <th>Recibida ahora</th><th>Incidencia</th><th>Observación</th></tr></thead>
        <tbody>${lineas.map((l) => `
          <tr data-detalle="${l.detalle_id}" data-pendiente="${l.pendiente}">
            <td><span class="codigo">${esc(l.codigo)}</span><br>${esc(l.descripcion)}</td>
            <td class="num">${l.cantidad_esperada}</td>
            <td class="num">${l.cantidad_recibida}</td>
            <td class="num">${l.pendiente}</td>
            <td><input type="number" min="0" step="1" value="${l.pendiente}" data-campo="cantidad" aria-label="Cantidad recibida de ${esc(l.descripcion)}"></td>
            <td><select data-campo="incidencia" aria-label="Incidencia de ${esc(l.descripcion)}">${opciones}</select></td>
            <td><input type="text" maxlength="160" data-campo="observacion" placeholder="Opcional" aria-label="Observación de ${esc(l.descripcion)}"></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <p class="error" id="errRecepcion" role="alert" hidden></p>
      <div class="acciones">
        <button id="btnConfirmar" class="btn confirmar">Confirmar recepción</button>
      </div>
    </div>`;

  const panel = $('#panelOrden');

  // Sugiere la incidencia según la cantidad, salvo que la persona ya la haya elegido.
  panel.querySelectorAll('tr[data-detalle]').forEach((fila) => {
    const cantidad = fila.querySelector('[data-campo="cantidad"]');
    const incidencia = fila.querySelector('[data-campo="incidencia"]');
    incidencia.addEventListener('change', () => { incidencia.dataset.manual = '1'; });
    cantidad.addEventListener('input', () => {
      if (incidencia.dataset.manual === '1') return;
      const pendiente = Number(fila.dataset.pendiente);
      const valor = Number(cantidad.value);
      incidencia.value = valor < pendiente ? 'FALTANTE' : valor > pendiente ? 'SOBRANTE' : 'NINGUNA';
    });
  });

  $('#btnConfirmar').addEventListener('click', async (e) => {
    const boton = e.currentTarget;
    const lineasEnviar = [...panel.querySelectorAll('tr[data-detalle]')].map((fila) => ({
      detalle_id: Number(fila.dataset.detalle),
      cantidad: fila.querySelector('[data-campo="cantidad"]').value,
      incidencia: fila.querySelector('[data-campo="incidencia"]').value,
      observacion: fila.querySelector('[data-campo="observacion"]').value
    }));
    boton.disabled = true;
    try {
      const r = await api('/api/recepciones', { method: 'POST', body: { referencia: orden.referencia, lineas: lineasEnviar } });
      mensajeRecepcion = `Orden ${r.referencia}: recepción registrada. La orden quedó ${r.estado === 'RECIBIDA' ? 'RECIBIDA' : 'PARCIAL'} y el inventario ya está actualizado.`;
      await vistaRecepcion();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      boton.disabled = false;
      mostrarError('#errRecepcion', err.message);
    }
  });
}

/* ---------- Arranque ---------- */
router();
