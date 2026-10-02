import { supabase } from './supabaseClient.js';

// Variables globales de estado
let tasaActual = 0;
let serviciosData = [];

document.addEventListener('DOMContentLoaded', async () => {
  const hoyStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  document.getElementById('fechaActualLabel').textContent = hoyStr;

  await cargarTasaBcv();
  await cargarSelects();
  await cargarVentasDia();

  // Event Listeners
  document.getElementById('btnGuardarTasa').addEventListener('click', guardarTasaBcv);
  document.getElementById('montoEur').addEventListener('input', calcularBolivares);
  document.getElementById('selectServicio').addEventListener('change', autocompletarPrecioServicio);
  document.getElementById('formVenta').addEventListener('submit', registrarVenta);
});

// 1. CARGAR TASA BCV
async function cargarTasaBcv() {
  try {
    const { data, error } = await supabase
      .from('tasa_bcv')
      .select('*')
      .order('id', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      tasaActual = parseFloat(data[0].monto_ves);
      document.getElementById('inputTasaBcv').value = tasaActual;
      calcularBolivares();
    }
  } catch (err) {
    console.error("Error al cargar la tasa BCV:", err);
  }
}

async function guardarTasaBcv() {
  const nuevaTasa = parseFloat(document.getElementById('inputTasaBcv').value);
  if (!nuevaTasa || nuevaTasa <= 0) {
    alert("Por favor ingresa una tasa válida.");
    return;
  }

  const { error } = await supabase
    .from('tasa_bcv')
    .insert([{ monto_ves: nuevaTasa, fecha: new Date() }]);

  if (error) {
    alert("Error al actualizar la tasa: " + error.message);
  } else {
    tasaActual = nuevaTasa;
    alert("¡Tasa BCV actualizada con éxito!");
    calcularBolivares();
    cargarVentasDia();
  }
}

// 2. CARGAR SELECTS (SERVICIOS Y ESPECIALISTAS)
async function cargarSelects() {
  // Cargar Servicios
  const { data: servs, error: errServ } = await supabase.from('servicios').select('*');
  if (!errServ && servs) {
    serviciosData = servs;
    const selectServ = document.getElementById('selectServicio');
    selectServ.innerHTML = '<option value="">Selecciona un servicio...</option>';
    servs.forEach(s => {
      selectServ.innerHTML += `<option value="${s.id}" data-precio="${s.precio_eur}">${s.nombre} (${s.categoria} - €${s.precio_eur})</option>`;
    });
  }

  // Cargar Especialistas
  const { data: esps, error: errEsp } = await supabase.from('especialistas').select('*').eq('activo', true);
  if (!errEsp && esps) {
    const selectEsp = document.getElementById('selectEspecialista');
    selectEsp.innerHTML = '<option value="">Selecciona especialista...</option>';
    esps.forEach(e => {
      selectEsp.innerHTML += `<option value="${e.id}" data-comision="${e.porcentaje_comision}">${e.nombre}</option>`;
    });
  }
}

function autocompletarPrecioServicio(e) {
  const selectedOption = e.target.options[e.target.selectedIndex];
  const precio = selectedOption.getAttribute('data-precio');
  if (precio) {
    document.getElementById('montoEur').value = precio;
    calcularBolivares();
  }
}

// 3. CALCULAR BOLÍVARES AUTOMÁTICAMENTE
function calcularBolivares() {
  const montoEur = parseFloat(document.getElementById('montoEur').value) || 0;
  const montoBs = montoEur * tasaActual;
  document.getElementById('montoBvInput').value = montoBs > 0 ? `${montoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs` : '0.00 Bs';
}

// 4. REGISTRAR VENTA
async function registrarVenta(e) {
  e.preventDefault();

  const nombreClienta = document.getElementById('nombreClienta').value;
  const servicioId = document.getElementById('selectServicio').value;
  const especialistaId = document.getElementById('selectEspecialista').value;
  const montoEur = parseFloat(document.getElementById('montoEur').value);
  const metodoPago = document.getElementById('metodoPago').value;
  const referenciaPago = document.getElementById('referenciaPago').value;
  const propinaEur = parseFloat(document.getElementById('propinaEur').value) || 0;
  const estadoPago = document.getElementById('estadoPago').value;

  const montoVes = montoEur * tasaActual;

  const nuevaVenta = {
    nombre_clienta: nombreClienta,
    servicio_id: servicioId,
    especialista_id: especialistaId,
    monto_eur: montoEur,
    tasa_aplicada: tasaActual,
    monto_ves: montoVes,
    metodo_pago: metodoPago,
    referencia_pago: referenciaPago,
    propina_eur: propinaEur,
    estado_pago: estadoPago
  };

  const { error } = await supabase.from('ventas_diarias').insert([nuevaVenta]);

  if (error) {
    alert("Error al registrar la venta: " + error.message);
  } else {
    alert("¡Venta registrada con éxito!");
    document.getElementById('formVenta').reset();
    document.getElementById('montoBvInput').value = '0.00 Bs';
    cargarVentasDia();
  }
}

// 5. CARGAR VENTAS DEL DÍA Y CALCULAR CIERRES
async function cargarVentasDia() {
  const hoyInicio = new Date();
  hoyInicio.setHours(0, 0, 0, 0);

  const { data: ventas, error } = await supabase
    .from('ventas_diarias')
    .select(`
      *,
      servicios (nombre, categoria),
      especialistas (nombre, porcentaje_comision)
    `)
    .gte('fecha', hoyInicio.toISOString())
    .order('fecha', { ascending: false });

  const tbody = document.getElementById('tablaVentasBody');
  if (error || !ventas || ventas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400">No hay transacciones registradas hoy.</td></tr>`;
    document.getElementById('totalDiaEur').textContent = '0,00 €';
    document.getElementById('totalDiaBs').textContent = '0,00 Bs';
    document.getElementById('totalServiciosCount').textContent = '0';
    document.getElementById('comisionesContainer').innerHTML = `<p class="text-slate-400">Sin comisiones que calcular hoy.</p>`;
    return;
  }

  let totalEur = 0;
  let totalBs = 0;
  let comisionesPorEsp = {};

  tbody.innerHTML = '';
  ventas.forEach(v => {
    totalEur += parseFloat(v.monto_eur);
    totalBs += parseFloat(v.monto_ves);

    const espNombre = v.especialistas ? v.especialistas.nombre : 'General';
    const porcentaje = v.especialistas ? parseFloat(v.especialistas.porcentaje_comision) : 40;
    
    if (!comisionesPorEsp[espNombre]) {
      comisionesPorEsp[espNombre] = { totalVentas: 0, comision: 0, porcentaje };
    }
    comisionesPorEsp[espNombre].totalVentas += parseFloat(v.monto_eur);
    comisionesPorEsp[espNombre].comision += parseFloat(v.monto_eur) * (porcentaje / 100);

    const badgeEstado = v.estado_pago === 'Pagado' 
      ? '<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium">Pagado</span>'
      : '<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">Por Cobrar</span>';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100">
        <td class="p-3 font-semibold text-slate-800">${v.nombre_clienta}</td>
        <td class="p-3">${v.servicios ? v.servicios.nombre : 'N/A'}</td>
        <td class="p-3 font-medium text-slate-600">${espNombre}</td>
        <td class="p-3 font-bold text-slate-900">€${parseFloat(v.monto_eur).toFixed(2)} <span class="text-[10px] text-slate-400 block">${parseFloat(v.monto_ves).toLocaleString('es-VE', {minimumFractionDigits:2})} Bs</span></td>
        <td class="p-3">${v.metodo_pago} <span class="text-[10px] text-slate-400 block">${v.referencia_pago || ''}</span></td>
        <td class="p-3">${badgeEstado}</td>
      </tr>
    `;
  });

  document.getElementById('totalDiaEur').textContent = `€${totalEur.toFixed(2)}`;
  document.getElementById('totalDiaBs').textContent = `${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
  document.getElementById('totalServiciosCount').textContent = ventas.length;

  const comContainer = document.getElementById('comisionesContainer');
  comContainer.innerHTML = '';
  for (const [esp, info] of Object.entries(comisionesPorEsp)) {
    comContainer.innerHTML += `
      <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl">
        <div class="flex justify-between items-center font-bold text-slate-800 mb-1">
          <span>${esp}</span>
          <span class="text-emerald-600">Comisión (${info.porcentaje}%): €${info.comision.toFixed(2)}</span>
        </div>
        <p class="text-[11px] text-slate-500">Total servicios recaudados: €${info.totalVentas.toFixed(2)}</p>
      </div>
    `;
  }
}

// ==========================================
// CONTROL DE MODALES
// ==========================================

async function guardarEspecialista(event) {
  event.preventDefault();
  const nombre = document.getElementById('inputNombreEspecialista').value;
  const porcentaje_comision = parseFloat(document.getElementById('inputComisionEspecialista').value);

  const { data, error } = await supabase
    .from('especialistas')
    .insert([{ nombre, porcentaje_comision, activo: true }]);

  if (!error) {
    alert('¡Especialista registrado con éxito!');
    cerrarModalEspecialista();
    cargarSelects();
  } else {
    alert('Error al registrar especialista: ' + error.message);
  }
}

async function guardarServicio(event) {
  event.preventDefault();
  const nombre = document.getElementById('inputNombreServicio').value;
  const categoria = document.getElementById('inputCategoriaServicio').value;
  const precio_eur = parseFloat(document.getElementById('inputPrecioServicio').value);

  const { data, error } = await supabase
    .from('servicios')
    .insert([{ nombre, categoria, precio_eur }]);

  if (!error) {
    alert('¡Servicio registrado con éxito!');
    cerrarModalServicio();
    cargarSelects();
  } else {
    alert('Error al registrar servicio: ' + error.message);
  }
}

function abrirModalGestionServicios() {
  document.getElementById('modalGestionServicios').classList.remove('hidden');
  cargarServiciosAdmin();
}

function cerrarModalGestionServicios() {
  document.getElementById('modalGestionServicios').classList.add('hidden');
}

function abrirModalGestionEspecialistas() {
  document.getElementById('modalGestionEspecialistas').classList.remove('hidden');
  cargarEspecialistasAdmin();
}

function cerrarModalGestionEspecialistas() {
  document.getElementById('modalGestionEspecialistas').classList.add('hidden');
}

async function cargarServiciosAdmin() {
  const contenedor = document.getElementById('listaServiciosAdmin');
  contenedor.innerHTML = '<p class="text-center text-gray-400 py-4">Cargando servicios...</p>';

  const { data, error } = await supabase.from('servicios').select('*').order('nombre');
  
  if (error) {
    contenedor.innerHTML = '<p class="text-center text-red-500 py-4">Error al cargar servicios.</p>';
    return;
  }

  if (data.length === 0) {
    contenedor.innerHTML = '<p class="text-center text-gray-400 py-4">No hay servicios registrados.</p>';
    return;
  }

  contenedor.innerHTML = '';
  data.forEach(s => {
    contenedor.innerHTML += `
      <div class="flex justify-between items-center py-3 px-2 hover:bg-gray-50 rounded-lg transition">
        <div>
          <p class="font-medium text-slate-800 text-sm">${s.nombre}</p>
          <span class="text-xs text-gray-500">${s.categoria || 'General'} • €${s.precio_eur}</span>
        </div>
        <button onclick="eliminarServicio('${s.id}')" class="bg-red-50 hover:bg-red-100 text-red-600 text-xs px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1">
          🗑️ Eliminar
        </button>
      </div>
    `;
  });
}

async function eliminarServicio(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar este servicio?')) return;

  const { error } = await supabase.from('servicios').delete().eq('id', id);
  if (!error) {
    alert('Servicio eliminado correctamente.');
    cargarServiciosAdmin();
    cargarSelects();
  } else {
    alert('No se pudo eliminar el servicio: ' + error.message);
  }
}

async function cargarEspecialistasAdmin() {
  const contenedor = document.getElementById('listaEspecialistasAdmin');
  contenedor.innerHTML = '<p class="text-center text-gray-400 py-4">Cargando especialistas...</p>';

  const { data, error } = await supabase.from('especialistas').select('*').order('nombre');
  
  if (error) {
    contenedor.innerHTML = '<p class="text-center text-red-500 py-4">Error al cargar especialistas.</p>';
    return;
  }

  if (data.length === 0) {
    contenedor.innerHTML = '<p class="text-center text-gray-400 py-4">No hay especialistas registrados.</p>';
    return;
  }

  contenedor.innerHTML = '';
  data.forEach(e => {
    contenedor.innerHTML += `
      <div class="flex justify-between items-center py-3 px-2 hover:bg-gray-50 rounded-lg transition">
        <div>
          <p class="font-medium text-slate-800 text-sm">${e.nombre}</p>
          <span class="text-xs text-gray-500">Comisión: ${e.porcentaje_comision}%</span>
        </div>
        <button onclick="eliminarEspecialista('${e.id}')" class="bg-red-50 hover:bg-red-100 text-red-600 text-xs px-3 py-1.5 rounded-lg font-medium transition flex items-center gap-1">
          🗑️ Eliminar
        </button>
      </div>
    `;
  });
}

async function eliminarEspecialista(id) {
  if (!confirm('¿Estás seguro de que deseas eliminar a este especialista?')) return;

  const { error } = await supabase.from('especialistas').delete().eq('id', id);
  if (!error) {
    alert('Especialista eliminado correctamente.');
    cargarEspecialistasAdmin();
    cargarSelects();
  } else {
    alert('No se pudo eliminar el especialista: ' + error.message);
  }
}
// ==========================================
// EXPONER FUNCIONES AL ÁMBITO GLOBAL (WINDOW)
// ==========================================
window.abrirModalVenta = function() {
  document.getElementById('modalVenta').classList.remove('hidden');
  if (typeof cargarSelects === 'function') cargarSelects();
};

window.cerrarModalVenta = function() {
  document.getElementById('modalVenta').classList.add('hidden');
};

window.abrirModalEspecialista = abrirModalEspecialista;
window.cerrarModalEspecialista = cerrarModalEspecialista;
window.abrirModalServicio = abrirModalServicio;
window.cerrarModalServicio = cerrarModalServicio;
window.abrirModalGestionServicios = abrirModalGestionServicios;
window.cerrarModalGestionServicios = cerrarModalGestionServicios;
window.abrirModalGestionEspecialistas = abrirModalGestionEspecialistas;
window.cerrarModalGestionEspecialistas = cerrarModalGestionEspecialistas;

// Renderizar servicios agrupados por categorías con edición de precio
window.cargarListaServiciosAdmin = async function() {
  const container = document.getElementById('listaServiciosAdmin');
  if (!container) return;

  const { data: servicios, error } = await supabase
    .from('servicios')
    .select('*')
    .order('categoria')
    .order('nombre');

  if (error || !servicios || servicios.length === 0) {
    container.innerHTML = `<p class="p-3 text-slate-400 text-center">No hay servicios registrados.</p>`;
    return;
  }

  // Definir las categorías fijas
  const categoriasFijas = ['Uñas', 'Estilismo', 'Extras'];

  // Agrupar los servicios por categoría
  const agrupados = {};
  
  // Inicializar grupos conocidos
  categoriasFijas.forEach(cat => agrupados[cat] = []);

  // Agrupar data de la base de datos
  servicios.forEach(s => {
    // Normalizar nombre de categoría o enviar a Extras si no coincide
    let catNormalizada = s.categoria ? s.categoria.trim() : 'Extras';
    if (!agrupados[catNormalizada]) {
      agrupados[catNormalizada] = [];
    }
    agrupados[catNormalizada].push(s);
  });

  // Renderizar HTML agrupado
  let htmlContent = '';

  Object.keys(agrupados).forEach(categoria => {
    const lista = agrupados[categoria];
    if (lista.length === 0) return; // Ocultar categoría si no tiene elementos

    htmlContent += `
      <div class="bg-slate-100/70 px-3 py-1.5 font-bold text-slate-700 text-[11px] uppercase tracking-wider border-y border-slate-200/80 flex items-center justify-between">
        <span>📂 ${categoria}</span>
        <span class="text-[10px] text-slate-400 font-normal">(${lista.length})</span>
      </div>
      <div class="divide-y divide-slate-100 bg-white">
    `;

    lista.forEach(s => {
      htmlContent += `
        <div class="flex items-center justify-between p-2.5 text-xs hover:bg-slate-50 transition">
          <div class="flex-1 pr-2">
            <p class="font-semibold text-slate-800 capitalize">${s.nombre}</p>
          </div>
          
          <!-- Edición de Precio e Interacción -->
          <div class="flex items-center gap-2">
            <div class="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 focus-within:border-slate-900 transition">
              <span class="text-slate-400 font-medium text-xs mr-1">€</span>
              <input 
                type="number" 
                step="0.01" 
                value="${parseFloat(s.precio || 0).toFixed(2)}" 
                id="inputPrecio_${s.id}"
                class="w-16 bg-transparent text-slate-800 font-bold text-xs text-right outline-none"
              />
            </div>

            <button 
              onclick="actualizarPrecioServicio('${s.id}')" 
              class="bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold px-2 py-1.5 rounded-lg transition"
              title="Guardar nuevo monto"
            >
              💾
            </button>

            <button 
              onclick="eliminarServicio('${s.id}')" 
              class="text-rose-500 hover:text-rose-700 font-bold px-1 text-xs"
              title="Eliminar servicio"
            >
              ✕
            </button>
          </div>
        </div>
      `;
    });

    htmlContent += `</div>`;
  });

  container.innerHTML = htmlContent || `<p class="p-3 text-slate-400 text-center">No hay servicios registrados.</p>`;
};

// Función para guardar la modificación de precio en Supabase
window.actualizarPrecioServicio = async function(idServicio) {
  const input = document.getElementById(`inputPrecio_${idServicio}`);
  if (!input) return;

  const nuevoPrecio = parseFloat(input.value);

  if (isNaN(nuevoPrecio) || nuevoPrecio < 0) {
    alert("Por favor, ingrese un monto válido.");
    return;
  }

  const { error } = await supabase
    .from('servicios')
    .update({ precio: nuevoPrecio })
    .eq('id', idServicio);

  if (error) {
    alert("Error al actualizar el precio: " + error.message);
  } else {
    // Feedback visual momentáneo
    input.classList.add('bg-emerald-100', 'text-emerald-800');
    setTimeout(() => {
      input.classList.remove('bg-emerald-100', 'text-emerald-800');
    }, 1000);
  }
};