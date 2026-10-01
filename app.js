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

    // Acumular comisiones por especialista
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

  // Actualizar tarjetas superiores
  document.getElementById('totalDiaEur').textContent = `€${totalEur.toFixed(2)}`;
  document.getElementById('totalDiaBs').textContent = `${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
  document.getElementById('totalServiciosCount').textContent = ventas.length;

  // Renderizar desglose de comisiones
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