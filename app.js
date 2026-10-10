import { supabase } from './supabaseClient.js';

// Variables globales de estado
let tasaActual = 0;
let serviciosData = [];
let especialistasData = [];
let ventasHoyCache = [];

// Variable global para Chart.js
let chartComparativoInstance = null;

// Variables para el manejo de cuentas abiertas y servicios temporales
let cuentaAbiertaActualId = null;
let serviciosCuentaTemporal = [];
let comisionesEspecificasCache = [];

// INICIALIZACIÓN
document.addEventListener('DOMContentLoaded', async () => {
  const hoyStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fechaLabel = document.getElementById('fechaActualLabel');
  if (fechaLabel) fechaLabel.textContent = hoyStr;

  // Precargar las fechas de los tres cierres a la fecha de hoy por defecto
  const hoyIsoStr = new Date().toISOString().split('T')[0];
  const mesIsoStr = hoyIsoStr.substring(0, 7);

  if (document.getElementById('filtroFechaDiario')) document.getElementById('filtroFechaDiario').value = hoyIsoStr;
  if (document.getElementById('filtroFechaSemanal')) document.getElementById('filtroFechaSemanal').value = hoyIsoStr;
  if (document.getElementById('filtroMesMensual')) document.getElementById('filtroMesMensual').value = mesIsoStr;

  await cargarTasaBcvEnLinea();
  await cargarSelects();
  await cargarComisionesPersonalizadas();
  await cargarVentasDia();

  // Event Listeners
  document.getElementById('montoEur')?.addEventListener('input', calcularBolivares);
  document.getElementById('selectServicio')?.addEventListener('change', window.alSeleccionarServicioYEspecialista);
  document.getElementById('selectEspecialista')?.addEventListener('change', window.alSeleccionarServicioYEspecialista);
  document.getElementById('formVenta')?.addEventListener('submit', registrarVenta);
});

// Cargar la tabla de comisiones personalizadas al iniciar
async function cargarComisionesPersonalizadas() {
  const { data } = await supabase.from('comisiones_especialista_servicio').select('*');
  comisionesEspecificasCache = data || [];
}

// Obtener el % de comisión dinámico al cambiar Servicio o Especialista
window.alSeleccionarServicioYEspecialista = function() {
  const selectServ = document.getElementById('selectServicio');
  const selectEsp = document.getElementById('selectEspecialista');
  const inputComision = document.getElementById('pctComisionServicio');
  const inputMonto = document.getElementById('montoEurServicio');

  if (!selectServ || !selectEsp) return;

  const servicioId = selectServ.value;
  const especialistaId = selectEsp.value;

  // Autocompletar precio del servicio si no ha sido editado
  if (servicioId) {
    const servObj = serviciosData.find(s => s.id == servicioId);
    if (servObj && inputMonto) {
      inputMonto.value = servObj.precio_eur !== undefined ? servObj.precio_eur : (servObj.precio || 0);
    }
  }

  if (!servicioId || !especialistaId) {
    if (inputComision) inputComision.value = '';
    return;
  }

  // Buscar si existe regla específica
  const reglaEspecial = comisionesEspecificasCache.find(
    c => c.especialista_id == especialistaId && c.servicio_id == servicioId
  );

  if (reglaEspecial) {
    inputComision.value = reglaEspecial.porcentaje_comision;
  } else {
    const espObj = especialistasData.find(e => e.id == especialistaId);
    inputComision.value = espObj ? (espObj.porcentaje_comision || 40) : 40;
  }
};

// A. Abrir el modal de venta / Gestión de Cuenta de Clienta
window.abrirModalVenta = async function(nombreClienteExistente = null) {
  window.openModal('modalVenta');
  cargarSelects();

  const fechaInput = document.getElementById('fechaVenta');
  if (fechaInput && !fechaInput.value) {
    fechaInput.value = new Date().toISOString().split('T')[0];
  }

  const inputTasa = document.getElementById('tasaAplicadaInput');
  if (inputTasa && tasaActual > 0) {
    inputTasa.value = tasaActual;
  }

  const inputNombre = document.getElementById('nombreClienta');

  // Si abrimos la cuenta de una clienta existente desde la tabla
  if (nombreClienteExistente) {
    if (inputNombre) {
      inputNombre.value = nombreClienteExistente;
    }
    await cargarServiciosDelDiaClienta(nombreClienteExistente);
  } else {
    // Si es un registro desde cero
    cuentaAbiertaActualId = null;
    serviciosCuentaTemporal = [];
    if (inputNombre) {
      inputNombre.value = '';
      inputNombre.disabled = false;
    }
    renderTablaServiciosAgregados();
  }
};

// C. Cargar todos los servicios registrados hoy para una clienta específica
async function cargarServiciosDelDiaClienta(nombreClienta) {
  const hoyStr = new Date().toISOString().split('T')[0];
  const inicioDia = `${hoyStr}T00:00:00`;
  const finDia = `${hoyStr}T23:59:59`;

  const { data, error } = await supabase
    .from('ventas_diarias')
    .select(`
      id, monto_eur, porcentaje_comision, estado_pago,
      servicios(nombre),
      especialistas(nombre)
    `)
    .ilike('nombre_clienta', nombreClienta)
    .gte('fecha', inicioDia)
    .lte('fecha', finDia);

  if (!error && data) {
    serviciosCuentaTemporal = data.map(item => ({
      id: item.id,
      servicio_nombre: item.servicios ? item.servicios.nombre : 'Servicio',
      especialista_nombre: item.especialistas ? item.especialistas.nombre : 'Especialista',
      monto_eur: parseFloat(item.monto_eur || 0),
      porcentaje_comision: parseFloat(item.porcentaje_comision || 40),
      estado_pago: item.estado_pago
    }));
    renderTablaServiciosAgregados();
  }
}

// B. Agregar servicio a la lista temporal/DB
window.agregarServicioALista = async function() {
  const nombreClienta = document.getElementById('nombreClienta').value.trim();
  const selectServ = document.getElementById('selectServicio');
  const selectEsp = document.getElementById('selectEspecialista');
  const inputMonto = document.getElementById('montoEurServicio');
  const inputComision = document.getElementById('pctComisionServicio');

  if (!nombreClienta) {
    alert("Por favor, ingresa primero el nombre de la clienta.");
    document.getElementById('nombreClienta').focus();
    return;
  }

  const servicioId = selectServ.value;
  const especialistaId = selectEsp.value;
  const monto = parseFloat(inputMonto.value) || 0;
  const porcentaje = parseFloat(inputComision.value) || 0;

  if (!servicioId || !especialistaId || monto <= 0) {
    alert("Selecciona un servicio, especialista e ingresa un monto válido.");
    return;
  }

  const servObj = serviciosData.find(s => s.id == servicioId);
  const espObj = especialistasData.find(e => e.id == especialistaId);

  // Agregar al arreglo local de la cuenta
  serviciosCuentaTemporal.push({
    servicio_id: servicioId,
    servicio_nombre: servObj ? servObj.nombre : 'Servicio',
    especialista_id: especialistaId,
    especialista_nombre: espObj ? espObj.nombre : 'Especialista',
    monto_eur: monto,
    porcentaje_comision: porcentaje
  });

  // Limpiar selectores
  selectServ.value = '';
  selectEsp.value = '';
  inputMonto.value = '';
  inputComision.value = '';

  renderTablaServiciosAgregados();
};

// D. Renderizar la tabla dentro del modal de venta
function renderTablaServiciosAgregados() {
  const tbody = document.getElementById('tablaServiciosAgregadosBody');
  const elTotalEur = document.getElementById('totalVentaModalEur');
  const elTotalBs = document.getElementById('totalVentaModalBs');

  if (!tbody) return;

  if (serviciosCuentaTemporal.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-3 text-center text-slate-400">Cuenta abierta sin servicios agregados aún.</td></tr>`;
    if (elTotalEur) elTotalEur.textContent = '€0.00';
    if (elTotalBs) elTotalBs.textContent = '0.00 Bs';
    return;
  }

  let totalEur = 0;
  tbody.innerHTML = serviciosCuentaTemporal.map((item, index) => {
    totalEur += item.monto_eur;
    const badgeEstado = item.id 
      ? `<span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">Guardado</span>`
      : `<span class="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">Nuevo</span>`;

    return `
      <tr class="border-b hover:bg-slate-50 text-xs">
        <td class="p-2.5 font-semibold text-slate-800">${item.servicio_nombre} ${badgeEstado}</td>
        <td class="p-2.5 text-slate-600">${item.especialista_nombre}</td>
        <td class="p-2.5 text-right font-bold text-slate-900">€${item.monto_eur.toFixed(2)}</td>
        <td class="p-2.5 text-center font-bold text-amber-600 bg-amber-50/50">${item.porcentaje_comision}%</td>
        <td class="p-2.5 text-center">
          <button type="button" onclick="window.eliminarServicioDeLista(${index})" class="text-rose-500 hover:text-rose-700 font-bold">✕</button>
        </td>
      </tr>
    `;
  }).join('');

  const tasaUso = parseFloat(document.getElementById('tasaAplicadaInput')?.value) || window.tasaActual || 0;
  const totalBs = totalEur * tasaUso;

  if (elTotalEur) elTotalEur.textContent = `€${totalEur.toFixed(2)}`;
  if (elTotalBs) elTotalBs.textContent = `${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
}

window.eliminarServicioDeLista = async function(index) {
  const item = serviciosCuentaTemporal[index];
  if (item.id) {
    // Si ya estaba guardado en la base de datos, lo eliminamos de la tabla ventas_diarias
    const { error } = await supabase.from('ventas_diarias').delete().eq('id', item.id);
    if (error) {
      alert("Error al eliminar servicio: " + error.message);
      return;
    }
  }
  serviciosCuentaTemporal.splice(index, 1);
  renderTablaServiciosAgregados();
};

// E. Registrar la Venta o Liquidar Cuenta Completa
async function registrarVenta(e) {
  e.preventDefault();

  if (serviciosCuentaTemporal.length === 0) {
    alert("La cuenta no tiene servicios agregados para procesar.");
    return;
  }

  const nombreClienta = document.getElementById('nombreClienta').value.trim();
  const fechaInput = document.getElementById('fechaVenta')?.value;
  const fechaSeleccionada = fechaInput ? new Date(fechaInput).toISOString() : new Date().toISOString();
  const tasaAplicada = parseFloat(document.getElementById('tasaAplicadaInput')?.value) || window.tasaActual || 0;

  const cash = parseFloat(document.getElementById('montoCash')?.value) || 0;
  const pm = parseFloat(document.getElementById('montoPagoMovil')?.value) || 0;
  const pdv = parseFloat(document.getElementById('montoPdv')?.value) || 0;
  const zelle = parseFloat(document.getElementById('montoZelle')?.value) || 0;

  const desgloseMetodos = [];
  if (cash > 0) desgloseMetodos.push(`Cash (€${cash})`);
  if (pm > 0) desgloseMetodos.push(`Pago Móvil (€${pm})`);
  if (pdv > 0) desgloseMetodos.push(`PDV (€${pdv})`);
  if (zelle > 0) desgloseMetodos.push(`Zelle (€${zelle})`);

  const metodoPagoFinal = desgloseMetodos.length > 0 ? desgloseMetodos.join(' + ') : 'Efectivo';
  const referenciaPago = document.getElementById('referenciaPago').value;
  const estadoPago = document.getElementById('estadoPago').value;

  // Filtrar ítems que son nuevos (no guardados aún en BD)
  const nuevosServicios = serviciosCuentaTemporal.filter(item => !item.id);

  if (nuevosServicios.length > 0) {
    const ventasInsertar = nuevosServicios.map(item => ({
      fecha: fechaSeleccionada,
      nombre_clienta: nombreClienta,
      servicio_id: item.servicio_id,
      especialista_id: item.especialista_id,
      porcentaje_comision: item.porcentaje_comision,
      monto_eur: item.monto_eur,
      tasa_aplicada: tasaAplicada,
      monto_ves: item.monto_eur * tasaAplicada,
      metodo_pago: metodoPagoFinal,
      referencia_pago: referenciaPago,
      estado_pago: estadoPago
    }));

    const { error } = await supabase.from('ventas_diarias').insert(ventasInsertar);
    if (error) {
      alert("Error al registrar servicios: " + error.message);
      return;
    }
  }

  // Si se selecciona "Pagado", actualizar todos los registros pendientes del día de esta clienta
  if (estadoPago === 'Pagado') {
    const hoyStr = new Date().toISOString().split('T')[0];
    await supabase
      .from('ventas_diarias')
      .update({
        estado_pago: 'Pagado',
        metodo_pago: metodoPagoFinal,
        referencia_pago: referenciaPago,
        tasa_aplicada: tasaAplicada
      })
      .ilike('nombre_clienta', nombreClienta)
      .gte('fecha', `${hoyStr}T00:00:00`);
  }

  alert("¡Cuenta procesada y actualizada con éxito!");
  serviciosCuentaTemporal = [];
  document.getElementById('formVenta').reset();
  window.cerrarModalVenta();
  cargarVentasDia();
}

// 1. TASA OFICIAL EURO BCV
async function cargarTasaBcvEnLinea() {
  const elMonto = document.getElementById('tasa-euro-monto');
  if (elMonto) elMonto.textContent = 'Cargando...';

  const apis = [
    async () => {
      const r = await fetch('https://pydolarve.org/api/v1/dollar?page=bcv');
      const d = await r.json();
      return d.monedas?.eur?.price || d.eur?.price;
    },
    async () => {
      const r = await fetch('https://ve.dolarapi.com/v1/euros/oficial');
      const d = await r.json();
      return d.promedio;
    },
    async () => {
      const r = await fetch('https://api.vedolar.com/v1/rates/bcv');
      const d = await r.json();
      return d.eur || d.euro;
    }
  ];

  for (const getRate of apis) {
    try {
      const euroValor = await getRate();
      if (euroValor && !isNaN(euroValor) && euroValor > 0) {
        tasaActual = parseFloat(euroValor);
        window.tasaActual = tasaActual;
        if (elMonto) {
          elMonto.textContent = `${tasaActual.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
        }
        if (typeof calcularBolivares === 'function') calcularBolivares();
        return;
      }
    } catch (e) {
      console.warn('Fallo intento de API Euro BCV:', e);
    }
  }

  if (elMonto) elMonto.textContent = 'No disponible';
}

// GESTIÓN DE MODAL DE GASTOS
window.abrirModalGasto = function() { window.openModal('modalGasto'); };
window.cerrarModalGasto = function() { window.closeModal('modalGasto'); };

window.registrarGasto = async function(e) {
  e.preventDefault();
  
  const concepto = document.getElementById('conceptoGasto').value;
  const categoria = document.getElementById('categoriaGasto').value;
  const montoEur = parseFloat(document.getElementById('montoGastoEur').value);
  const metodoPago = document.getElementById('metodoPagoGasto').value;
  const montoVes = montoEur * (tasaActual || 0);

  const { error } = await supabase.from('gastos_operativos').insert([{
    concepto,
    categoria,
    monto_eur: montoEur,
    monto_ves: montoVes,
    metodo_pago: metodoPago,
    tasa_aplicada: tasaActual,
    fecha: new Date().toISOString()
  }]);

  if (error) {
    alert("Error al registrar gasto: " + error.message);
  } else {
    alert("¡Gasto registrado con éxito!");
    document.getElementById('formGasto').reset();
    window.cerrarModalGasto();
  }
};

// 2. CARGAR SELECTS
async function cargarSelects() {
  const { data: servs, error: errServ } = await supabase.from('servicios').select('*');
  if (!errServ && servs) {
    serviciosData = servs;
    const selectServ = document.getElementById('selectServicio');
    if (selectServ) {
      selectServ.innerHTML = '<option value="">Selecciona un servicio...</option>';
      servs.forEach(s => {
        const precio = s.precio_eur !== undefined ? s.precio_eur : (s.precio || 0);
        selectServ.innerHTML += `<option value="${s.id}" data-precio="${precio}">${s.nombre} (${s.categoria || 'General'} - €${precio})</option>`;
      });
    }
  }

  const { data: esps, error: errEsp } = await supabase.from('especialistas').select('*').eq('activo', true);
  if (!errEsp && esps) {
    especialistasData = esps;
    window.especialistas = esps;
    const selectEsp = document.getElementById('selectEspecialista');
    if (selectEsp) {
      selectEsp.innerHTML = '<option value="">Selecciona especialista...</option>';
      esps.forEach(e => {
        selectEsp.innerHTML += `<option value="${e.id}" data-comision="${e.porcentaje_comision}">${e.nombre}</option>`;
      });
    }
  }
}

function calcularBolivares() {
  const tasaInput = document.getElementById('tasaAplicadaInput');
  if (!tasaInput) return;
  renderTablaServiciosAgregados();
}

// 5. CARGAR VENTAS DEL DÍA Y DIBUJAR TARJETAS
window.cargarVentasDia = async function() {
  const hoy = new Date();
  const fechaHoyStr = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0') + '-' + String(hoy.getDate()).padStart(2, '0') + 'T00:00:00';

  const { data: ventas, error } = await supabase
    .from('ventas_diarias')
    .select(`
      *,
      servicios (nombre, categoria),
      especialistas (nombre, porcentaje_comision)
    `)
    .gte('fecha', fechaHoyStr)
    .order('fecha', { ascending: false });

  ventasHoyCache = ventas || [];
  window.ventas = ventasHoyCache;

  const tbody = document.getElementById('tablaVentasBody');
  if (!tbody) return;

  if (error || !ventas || ventas.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400">No hay transacciones registradas hoy.</td></tr>`;
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
    totalEur += parseFloat(v.monto_eur || 0);
    totalBs += parseFloat(v.monto_ves || 0);

    const espNombre = v.especialistas ? v.especialistas.nombre : 'General';
    const porcentaje = v.porcentaje_comision !== undefined && v.porcentaje_comision !== null ? parseFloat(v.porcentaje_comision) : (v.especialistas ? parseFloat(v.especialistas.porcentaje_comision) : 40);
    
    if (!comisionesPorEsp[espNombre]) {
      comisionesPorEsp[espNombre] = { totalVentas: 0, comision: 0, porcentaje };
    }
    comisionesPorEsp[espNombre].totalVentas += parseFloat(v.monto_eur || 0);
    comisionesPorEsp[espNombre].comision += parseFloat(v.monto_eur || 0) * (porcentaje / 100);

    const badgeEstado = v.estado_pago === 'Pagado' 
      ? '<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium">Pagado</span>'
      : '<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">Por Cobrar</span>';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-xs">
        <td class="p-3 font-semibold text-slate-800 capitalize">${v.nombre_clienta}</td>
        <td class="p-3">${v.servicios ? v.servicios.nombre : 'N/A'}</td>
        <td class="p-3 font-medium text-slate-600">${espNombre}</td>
        <td class="p-3 font-bold text-slate-900">€${parseFloat(v.monto_eur || 0).toFixed(2)} <span class="text-[10px] text-slate-400 block">${parseFloat(v.monto_ves || 0).toLocaleString('es-VE', {minimumFractionDigits:2})} Bs</span></td>
        <td class="p-3">${v.metodo_pago} <span class="text-[10px] text-slate-400 block">${v.referencia_pago || ''}</span></td>
        <td class="p-3">${badgeEstado}</td>
        <td class="p-3 text-center">
          <button onclick="window.abrirModalVenta('${v.nombre_clienta.replace(/'/g, "\\'")}')" class="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[10px] px-2.5 py-1.5 rounded-lg transition" title="Ver cuenta completa de la clienta">
            📂 Cuenta
          </button>
        </td>
      </tr>
    `;
  });

  document.getElementById('totalDiaEur').textContent = `€${totalEur.toFixed(2)}`;
  document.getElementById('totalDiaBs').textContent = `${totalBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs`;
  document.getElementById('totalServiciosCount').textContent = ventas.length;

  const comContainer = document.getElementById('comisionesContainer');
  if (comContainer) {
    comContainer.innerHTML = '';
    for (const [esp, info] of Object.entries(comisionesPorEsp)) {
      comContainer.innerHTML += `
        <div 
          onclick="window.verDetalleEspecialista('${esp}')" 
          class="p-3.5 bg-slate-50 hover:bg-emerald-50/50 border border-slate-200 hover:border-emerald-300 rounded-xl cursor-pointer transition active:scale-98 shadow-2xs"
        >
          <div class="flex justify-between items-center font-bold text-slate-800 mb-1">
            <span class="flex items-center gap-1.5 capitalize">👩‍🎨 ${esp}</span>
            <span class="text-emerald-600 font-extrabold">Comisión: €${info.comision.toFixed(2)}</span>
          </div>
          <p class="text-[11px] text-slate-500">Total servicios recaudados: €${info.totalVentas.toFixed(2)}</p>
        </div>
      `;
    }
  }
};

// 6. DETALLE POR ESPECIALISTA
window.verDetalleEspecialista = function(nombreEspecialista) {
  const serviciosEsp = ventasHoyCache.filter(v => {
    const espNom = v.especialistas ? v.especialistas.nombre : 'General';
    return espNom.toLowerCase() === nombreEspecialista.toLowerCase();
  });

  const tbody = document.getElementById('tablaDetalleEspecialistaBody');
  const modalNombre = document.getElementById('modalDetalleNombre');
  const modalSubtitulo = document.getElementById('modalDetalleSubtitulo');
  const modalRecaudado = document.getElementById('modalTotalRecaudado');
  const modalComision = document.getElementById('modalTotalComision');

  if (!tbody) return;

  if (modalNombre) modalNombre.textContent = `Detalle: ${nombreEspecialista}`;

  if (serviciosEsp.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">No hay registros para esta especialista hoy.</td></tr>`;
    if (modalRecaudado) modalRecaudado.textContent = '€0.00';
    if (modalComision) modalComision.textContent = '€0.00';
    return;
  }

  let totalRecaudado = 0;
  let totalComisiones = 0;
  let totalPropinas = 0;

  if (modalSubtitulo) {
    modalSubtitulo.textContent = `${serviciosEsp.length} servicio(s) realizado(s) hoy`;
  }

  tbody.innerHTML = '';
  serviciosEsp.forEach(s => {
    const monto = parseFloat(s.monto_eur || 0);
    const propina = parseFloat(s.propina_eur || 0);
    const pct = s.porcentaje_comision !== undefined && s.porcentaje_comision !== null ? parseFloat(s.porcentaje_comision) : (s.especialistas ? parseFloat(s.especialistas.porcentaje_comision) : 40);
    const comisionUnit = monto * (pct / 100);

    totalRecaudado += monto;
    totalComisiones += comisionUnit;
    totalPropinas += propina;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-xs">
        <td class="p-3 font-semibold text-slate-800 capitalize">${s.nombre_clienta || 'S/N'}</td>
        <td class="p-3 font-medium">${s.servicios ? s.servicios.nombre : 'Servicio'} <span class="text-[10px] text-amber-600 block">(${pct}%)</span></td>
        <td class="p-3">${s.metodo_pago || 'Cash'} <span class="text-[10px] text-slate-400 block">${s.referencia_pago || 'Sin Ref.'}</span></td>
        <td class="p-3 text-right font-bold text-slate-800">€${monto.toFixed(2)}</td>
        <td class="p-3 text-right font-semibold text-amber-600 bg-amber-50/30">€${propina.toFixed(2)}</td>
        <td class="p-3 text-right font-extrabold text-emerald-600 bg-emerald-50/30">€${comisionUnit.toFixed(2)}</td>
      </tr>
    `;
  });

  const totalACobrarEur = totalComisiones + totalPropinas;
  const totalACobrarBs = totalACobrarEur * (tasaActual || 0);

  if (modalRecaudado) {
    modalRecaudado.textContent = `€${totalRecaudado.toFixed(2)}`;
  }

  if (modalComision) {
    modalComision.innerHTML = `
      <div class="text-right">
        <span class="text-emerald-600 font-extrabold text-base">€${totalACobrarEur.toFixed(2)}</span>
        <span class="text-xs text-slate-500 block font-normal">
          (Comisión: €${totalComisiones.toFixed(2)} + Propina: €${totalPropinas.toFixed(2)})
        </span>
        <span class="text-xs text-blue-600 font-bold block mt-0.5">
          ${totalACobrarBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs
        </span>
      </div>
    `;
  }

  window.openModal('modalDetalleEspecialista');
};

// 7. CIERRE DIARIO
window.renderCierreDiario = async function() {
  const tbody = document.getElementById('tablaServiciosDiarios');
  const listaComisiones = document.getElementById('listaComisiones');
  const elFechaDiario = document.getElementById('fechaDiario');
  const elTotalBruto = document.getElementById('cierreTotalBruto');
  const elTotalOlivetta = document.getElementById('cierreTotalOlivetta');
  const elTotalRecaudado = document.getElementById('cierreTotalRecaudado');
  const elCierreCaja = document.getElementById('cierreCajaFinal');
  
  if (!tbody) return;

  const fechaFiltroVal = document.getElementById('filtroFechaDiario')?.value;
  const fechaObj = fechaFiltroVal ? new Date(fechaFiltroVal + 'T00:00:00') : new Date();
  const fechaIsoStr = fechaFiltroVal || new Date().toISOString().split('T')[0];

  if (elFechaDiario) {
    elFechaDiario.textContent = `Resumen al ${fechaObj.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
  }

  const inicioDia = `${fechaIsoStr}T00:00:00`;
  const finDia = `${fechaIsoStr}T23:59:59`;

  const { data: ventasDiariasBusqueda } = await supabase
    .from('ventas_diarias')
    .select(`
      *,
      servicios (nombre, categoria),
      especialistas (nombre, porcentaje_comision)
    `)
    .gte('fecha', inicioDia)
    .lte('fecha', finDia);

  const ventasHoy = ventasDiariasBusqueda || [];

  if (ventasHoy.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No hay ventas registradas en esta fecha.</td></tr>`;
    if (listaComisiones) listaComisiones.innerHTML = '<li class="text-slate-400">• Sin comisiones ni propinas en esta fecha</li>';
    if (elTotalBruto) elTotalBruto.textContent = '0.00 €';
    if (elTotalOlivetta) elTotalOlivetta.textContent = '0.00 $';
    if (elTotalRecaudado) elTotalRecaudado.textContent = '0.00 €';
    if (elCierreCaja) elCierreCaja.textContent = '0.00 €';
    return;
  }

  let totalBrutoDiaEur = 0;
  let totalOlivettaDiaUsd = 0;
  let totalComisionesYPropinasPagar = 0;

  tbody.innerHTML = ventasHoy.map((v, index) => {
    const propina = parseFloat(v.propina_eur) || 0;
    const servicioNombre = v.servicios ? v.servicios.nombre : '-';
    const espNombre = v.especialistas ? v.especialistas.nombre : 'Sin Asignar';
    const montoEur = parseFloat(v.monto_eur) || 0;
    const montoBs = parseFloat(v.monto_ves) || 0;
    const olivettaUsd = parseFloat(v.monto_olivetta_usd) || 0;

    totalBrutoDiaEur += montoEur;
    totalOlivettaDiaUsd += olivettaUsd;

    return `
      <tr class="border-b hover:bg-slate-50 text-xs">
        <td class="p-2 font-semibold text-slate-500">${index + 1}</td>
        <td class="p-2 font-medium capitalize">${v.nombre_clienta || 'S/N'}</td>
        <td class="p-2">${servicioNombre}</td>
        <td class="p-2 font-semibold">${espNombre}</td>
        <td class="p-2 font-semibold">
          ${montoEur.toFixed(2)} € 
          ${propina > 0 ? `<span class="text-emerald-600 text-[10px] block">(+${propina.toFixed(2)}€ propina)</span>` : ''}
          ${olivettaUsd > 0 ? `<span class="text-amber-600 text-[10px] block">(🍹 $${olivettaUsd.toFixed(2)} Olivetta)</span>` : ''}
        </td>
        <td class="p-2 text-xs">${v.metodo_pago || '-'} ${montoBs ? `(${montoBs.toLocaleString('es-VE', {minimumFractionDigits:2})} Bs)` : ''}</td>
        <td class="p-2 text-xs text-slate-500">${v.referencia_pago || '-'}</td>
      </tr>
    `;
  }).join('');

  const acumuladoProf = {};

  ventasHoy.forEach(v => {
    const monto = parseFloat(v.monto_eur) || 0;
    const propina = parseFloat(v.propina_eur) || 0;
    const prof = v.especialistas ? v.especialistas.nombre : 'Sin Asignar';
    const pct = v.porcentaje_comision !== undefined && v.porcentaje_comision !== null ? parseFloat(v.porcentaje_comision) : (v.especialistas ? parseFloat(v.especialistas.porcentaje_comision) : 40);

    if (!acumuladoProf[prof]) {
      acumuladoProf[prof] = { totalServicios: 0, propinas: 0, comisionTotal: 0 };
    }
    acumuladoProf[prof].totalServicios += monto;
    acumuladoProf[prof].propinas += propina;
    acumuladoProf[prof].comisionTotal += (monto * pct) / 100;
  });

  if (listaComisiones) {
    let htmlComisiones = '';

    Object.keys(acumuladoProf).forEach(p => {
      const item = acumuladoProf[p];
      const totalAPagar = item.comisionTotal + item.propinas;
      totalComisionesYPropinasPagar += totalAPagar;

      htmlComisiones += `
        <li class="mb-1">• <strong>${p}:</strong> 
          Comisión = ${item.comisionTotal.toFixed(2)} € 
          ${item.propinas > 0 ? `<span class="text-amber-600 font-semibold">+ ${item.propinas.toFixed(2)} € propina</span>` : ''}
          ➡ <span class="font-extrabold text-emerald-600">Total: ${totalAPagar.toFixed(2)} €</span>
        </li>`;
    });

    listaComisiones.innerHTML = htmlComisiones;
  }

  const totalNetoMoonEur = totalBrutoDiaEur - totalOlivettaDiaUsd;
  const saldoNetoCaja = totalNetoMoonEur - totalComisionesYPropinasPagar;

  if (elTotalBruto) elTotalBruto.textContent = `${totalBrutoDiaEur.toFixed(2)} €`;
  if (elTotalOlivetta) elTotalOlivetta.textContent = `$${totalOlivettaDiaUsd.toFixed(2)} USD`;
  if (elTotalRecaudado) elTotalRecaudado.textContent = `${totalNetoMoonEur.toFixed(2)} €`;
  if (elCierreCaja) elCierreCaja.textContent = `${saldoNetoCaja.toFixed(2)} €`;
};

// 8. CIERRE SEMANAL
window.renderCierreSemanal = async function() {
  const tbody = document.getElementById('tablaNominaSemanal');
  const elIngresosArea = document.getElementById('ingresosPorAreaContainer');
  const elDistribucionPago = document.getElementById('distribucionPagosContainer');
  const elBalanceSemanal = document.getElementById('balanceNetoSemanalVal');
  const elCuentasPendientes = document.getElementById('cuentasPendientesSemanalVal');
  const elRangoSemana = document.getElementById('rangoSemanaLabel');

  if (!tbody) return;

  const fechaFiltroVal = document.getElementById('filtroFechaSemanal')?.value;
  const fechaBase = fechaFiltroVal ? new Date(fechaFiltroVal + 'T00:00:00') : new Date();

  const day = fechaBase.getDay();
  const offsetSabado = (day === 6) ? 0 : (day + 1);
  
  const sabadoInicio = new Date(fechaBase);
  sabadoInicio.setDate(sabadoInicio.getDate() - offsetSabado);
  sabadoInicio.setHours(0,0,0,0);

  const viernesFin = new Date(sabadoInicio);
  viernesFin.setDate(viernesFin.getDate() + 6);
  viernesFin.setHours(23,59,59,999);

  const domingoPago = new Date(sabadoInicio);
  domingoPago.setDate(domingoPago.getDate() + 8);

  if (elRangoSemana) {
    const f1 = sabadoInicio.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    const f2 = viernesFin.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const fPago = domingoPago.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    elRangoSemana.textContent = `Ciclo: Sáb ${f1} al Vie ${f2} | 🗓️ Pago Nómina: Dom ${fPago}`;
  }

  const { data: ventasSemana } = await supabase
    .from('ventas_diarias')
    .select(`*, servicios(nombre, categoria), especialistas(nombre, porcentaje_comision)`)
    .gte('fecha', sabadoInicio.toISOString())
    .lte('fecha', viernesFin.toISOString());

  const { data: gastosSemana } = await supabase
    .from('gastos_operativos')
    .select('*')
    .gte('fecha', sabadoInicio.toISOString())
    .lte('fecha', viernesFin.toISOString());

  const ventas = ventasSemana || [];
  const gastos = gastosSemana || [];
  const especialistas = window.especialistas || [];

  let htmlTabla = '';
  let totalComisionesYPropinasSemana = 0;

  especialistas.forEach(esp => {
    const ventasEsp = ventas.filter(v => (v.especialistas ? v.especialistas.nombre : '') === esp.nombre);
    
    let totalComisionEur = 0;
    let totalPropinasEur = 0;

    ventasEsp.forEach(v => {
      const monto = parseFloat(v.monto_eur) || 0;
      const prop = parseFloat(v.propina_eur) || 0;
      const pct = v.porcentaje_comision !== undefined && v.porcentaje_comision !== null ? parseFloat(v.porcentaje_comision) : (esp.porcentaje_comision || 40);
      totalComisionEur += (monto * pct) / 100;
      totalPropinasEur += prop;
    });

    const totalCobroEsp = totalComisionEur + totalPropinasEur;
    const totalBs = totalCobroEsp * (tasaActual || 1);

    totalComisionesYPropinasSemana += totalCobroEsp;

    htmlTabla += `
      <tr class="border-b text-xs">
        <td class="p-2 font-bold text-left capitalize">${esp.nombre}</td>
        <td class="p-2" colspan="2">${ventasEsp.length} servicio(s)</td>
        <td class="p-2 text-amber-600 font-medium">+${totalPropinasEur.toFixed(2)} €</td>
        <td class="p-2 font-bold bg-amber-50">€${totalCobroEsp.toFixed(2)}</td>
        <td class="p-2 font-semibold bg-blue-50">${totalBs.toLocaleString('es-VE', {minimumFractionDigits: 2})} Bs</td>
      </tr>
    `;
  });

  tbody.innerHTML = htmlTabla || `<tr><td colspan="6" class="p-4 text-center text-slate-400">Sin datos en este ciclo semanal.</td></tr>`;

  const ingresosPorCategoria = {};
  let totalVentasSemanaEur = 0;
  let cuentasPendientes = 0;

  ventas.forEach(v => {
    // Normalizar la categoría para evitar duplicados por mayúsculas/minúsculas (ej: "Uñas" y "uñas")
    let catRaw = (v.servicios && v.servicios.categoria) ? v.servicios.categoria.trim() : 'General';
    const cat = catRaw.charAt(0).toUpperCase() + catRaw.slice(1).toLowerCase();
    
    const monto = parseFloat(v.monto_eur) || 0;
    
    if (!ingresosPorCategoria[cat]) {
      ingresosPorCategoria[cat] = { monto: 0, cantidad: 0 };
    }
    ingresosPorCategoria[cat].monto += monto;
    ingresosPorCategoria[cat].cantidad += 1;

    totalVentasSemanaEur += monto;

    if (v.estado_pago === 'Por Cobrar') {
      cuentasPendientes += monto;
    }
  });

  if (elIngresosArea) {
    elIngresosArea.innerHTML = Object.entries(ingresosPorCategoria).map(([cat, info]) => `
      <div class="flex justify-between items-center text-xs py-1 border-b border-slate-100 last:border-b-0">
        <span class="font-semibold text-slate-700">${cat} <span class="text-[10px] text-slate-400">(${info.cantidad} serv.)</span>:</span>
        <span class="font-bold text-slate-900">€${info.monto.toFixed(2)}</span>
      </div>
    `).join('') || '<p class="text-xs text-slate-400">Sin registros</p>';
  }

  const distribucionPagos = {
    'Pago Móvil': { eur: 0, bs: 0 },
    'Punto de Venta (PDV)': { eur: 0, bs: 0 },
    'Efectivo / Cash': { eur: 0, bs: 0 },
    'Zelle': { eur: 0, bs: 0 },
    'Otros': { eur: 0, bs: 0 }
  };

  ventas.forEach(v => {
    const metodoRaw = (v.metodo_pago || '').toLowerCase();
    const montoEur = parseFloat(v.monto_eur) || 0;
    const montoBs = parseFloat(v.monto_ves) || 0;

    if (metodoRaw.includes('pago móvil') || metodoRaw.includes('pago movil') || metodoRaw.includes('pm')) {
      distribucionPagos['Pago Móvil'].eur += montoEur;
      distribucionPagos['Pago Móvil'].bs += montoBs;
    } else if (metodoRaw.includes('punto') || metodoRaw.includes('pdv')) {
      distribucionPagos['Punto de Venta (PDV)'].eur += montoEur;
      distribucionPagos['Punto de Venta (PDV)'].bs += montoBs;
    } else if (metodoRaw.includes('cash') || metodoRaw.includes('efectivo')) {
      distribucionPagos['Efectivo / Cash'].eur += montoEur;
      distribucionPagos['Efectivo / Cash'].bs += montoBs;
    } else if (metodoRaw.includes('zelle')) {
      distribucionPagos['Zelle'].eur += montoEur;
      distribucionPagos['Zelle'].bs += montoBs;
    } else {
      distribucionPagos['Otros'].eur += montoEur;
      distribucionPagos['Otros'].bs += montoBs;
    }
  });

  if (elDistribucionPago) {
    let htmlMetodos = '';

    Object.entries(distribucionPagos).forEach(([metodo, totales]) => {
      if (totales.eur > 0 || totales.bs > 0) {
        const tieneBs = totales.bs > 0;
        
        htmlMetodos += `
          <div class="flex justify-between items-center text-xs py-1.5 border-b border-slate-100 last:border-b-0">
            <span class="font-bold text-slate-700">💳 ${metodo}:</span>
            <div class="text-right">
              <span class="font-black text-slate-900 block">€${totales.eur.toFixed(2)}</span>
              ${tieneBs ? `<span class="text-[10px] text-slate-500 font-medium block">(${totales.bs.toLocaleString('es-VE', {minimumFractionDigits: 2})} Bs)</span>` : ''}
            </div>
          </div>
        `;
      }
    });

    elDistribucionPago.innerHTML = htmlMetodos || '<p class="text-xs text-slate-400">Sin transacciones registradas</p>';
  }

  const totalGastosSemanaEur = gastos.reduce((acc, g) => acc + (parseFloat(g.monto_eur) || 0), 0);
  const balanceNeto = totalVentasSemanaEur - totalComisionesYPropinasSemana - totalGastosSemanaEur;

  if (elBalanceSemanal) elBalanceSemanal.textContent = `€${balanceNeto.toFixed(2)}`;
  if (elCuentasPendientes) elCuentasPendientes.textContent = `Cuentas por Cobrar Pendientes: €${cuentasPendientes.toFixed(2)}`;

  const totalOlivettaSemanaUsd = ventas.reduce((acc, v) => acc + (parseFloat(v.monto_olivetta_usd) || 0), 0);
  const elOlivettaContainer = document.getElementById('totalOlivettaSemanalVal');
  if (elOlivettaContainer) {
    elOlivettaContainer.textContent = `$${totalOlivettaSemanaUsd.toFixed(2)} USD`;
  }
};

// 9. DASHBOARD MENSUAL
window.renderCierreMensual = async function() {
  const elIngresosTotales = document.getElementById('mensualIngresosTotales');
  const elOlivettaTotales = document.getElementById('mensualOlivettaTotales');
  const elNetoMoon = document.getElementById('mensualNetoMoon');
  const elNominaComisiones = document.getElementById('mensualNominaComisiones');
  const elGastosOperativos = document.getElementById('mensualGastosOperativos');
  const elGananciaNeta = document.getElementById('mensualGananciaNeta');
  const elMesLabel = document.getElementById('mesSeleccionadoLabel');

  const mesFiltroVal = document.getElementById('filtroMesMensual')?.value;
  
  let anoSeleccionado, mesIndex;

  if (mesFiltroVal) {
    const [year, month] = mesFiltroVal.split('-');
    anoSeleccionado = parseInt(year);
    mesIndex = parseInt(month) - 1;
  } else {
    const ahora = new Date();
    anoSeleccionado = ahora.getFullYear();
    mesIndex = ahora.getMonth();
  }

  const fechaInicioActual = new Date(anoSeleccionado, mesIndex, 1).toISOString();
  const fechaFinActual = new Date(anoSeleccionado, mesIndex + 1, 0, 23, 59, 59, 999).toISOString();

  if (elMesLabel) {
    const nomMes = new Date(anoSeleccionado, mesIndex, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    elMesLabel.textContent = `Resumen consolidado para ${nomMes}`;
  }

  const { data: ventasMes } = await supabase
    .from('ventas_diarias')
    .select(`*, especialistas(porcentaje_comision)`)
    .gte('fecha', fechaInicioActual)
    .lte('fecha', fechaFinActual);

  const { data: gastosMes } = await supabase
    .from('gastos_operativos')
    .select('*')
    .gte('fecha', fechaInicioActual)
    .lte('fecha', fechaFinActual);

  const ventas = ventasMes || [];
  const gastos = gastosMes || [];

  let ingresosBrutosEur = 0;
  let totalOlivettaUsd = 0;
  let nominaComisionesTotales = 0;

  ventas.forEach(v => {
    const monto = parseFloat(v.monto_eur) || 0;
    const propina = parseFloat(v.propina_eur) || 0;
    const olivetta = parseFloat(v.monto_olivetta_usd) || 0;
    const pct = v.porcentaje_comision !== undefined && v.porcentaje_comision !== null ? parseFloat(v.porcentaje_comision) : (v.especialistas ? parseFloat(v.especialistas.porcentaje_comision) : 40);

    ingresosBrutosEur += monto;
    totalOlivettaUsd += olivetta;
    nominaComisionesTotales += ((monto * pct) / 100) + propina;
  });

  const gastosTotales = gastos.reduce((acc, g) => acc + (parseFloat(g.monto_eur) || 0), 0);
  const montoNetoMoon = ingresosBrutosEur - totalOlivettaUsd;
  const gananciaNeta = montoNetoMoon - nominaComisionesTotales - gastosTotales;

  if (elIngresosTotales) elIngresosTotales.textContent = `€${ingresosBrutosEur.toFixed(2)}`;
  if (elOlivettaTotales) elOlivettaTotales.textContent = `$${totalOlivettaUsd.toFixed(2)} USD`;
  if (elNetoMoon) elNetoMoon.textContent = `€${montoNetoMoon.toFixed(2)}`;
  if (elNominaComisiones) elNominaComisiones.textContent = `€${nominaComisionesTotales.toFixed(2)}`;
  if (elGastosOperativos) elGastosOperativos.textContent = `€${gastosTotales.toFixed(2)}`;
  if (elGananciaNeta) elGananciaNeta.textContent = `€${gananciaNeta.toFixed(2)}`;

  const ultimos3Meses = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(anoSeleccionado, mesIndex - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    
    ultimos3Meses.push({
      etiqueta: d.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase(),
      inicio: new Date(y, m, 1).toISOString(),
      fin: new Date(y, m + 1, 0, 23, 59, 59, 999).toISOString()
    });
  }

  const datosPromesas = ultimos3Meses.map(async (mInfo) => {
    const { data: vts } = await supabase
      .from('ventas_diarias')
      .select(`monto_eur, propina_eur, monto_olivetta_usd, porcentaje_comision, especialistas(porcentaje_comision)`)
      .gte('fecha', mInfo.inicio)
      .lte('fecha', mInfo.fin);

    const { data: gts } = await supabase
      .from('gastos_operativos')
      .select('monto_eur')
      .gte('fecha', mInfo.inicio)
      .lte('fecha', mInfo.fin);

    let bruto = 0;
    let olivetta = 0;
    let nominaComisiones = 0;

    (vts || []).forEach(v => {
      const monto = parseFloat(v.monto_eur) || 0;
      const propina = parseFloat(v.propina_eur) || 0;
      const oliv = parseFloat(v.monto_olivetta_usd) || 0;
      const pct = v.porcentaje_comision !== undefined && v.porcentaje_comision !== null ? parseFloat(v.porcentaje_comision) : (v.especialistas ? parseFloat(v.especialistas.porcentaje_comision) : 40);

      bruto += monto;
      olivetta += oliv;
      nominaComisiones += ((monto * pct) / 100) + propina;
    });

    const gastosMes = (gts || []).reduce((acc, g) => acc + (parseFloat(g.monto_eur) || 0), 0);
    const netoMoon = bruto - olivetta;
    const gananciaNetaCalculada = netoMoon - nominaComisiones - gastosMes;

    return {
      mes: mInfo.etiqueta,
      bruto: bruto,
      gananciaNeta: gananciaNetaCalculada
    };
  });

  const datosTrimestre = await Promise.all(datosPromesas);

  const canvas = document.getElementById('graficoTrimestralCanvas');
  if (!canvas) return;

  if (chartComparativoInstance) {
    chartComparativoInstance.destroy();
  }

  chartComparativoInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: datosTrimestre.map(d => d.mes),
      datasets: [
        {
          label: 'Ingresos Brutos (€)',
          data: datosTrimestre.map(d => d.bruto),
          backgroundColor: '#3b82f6',
          borderRadius: 6
        },
        {
          label: 'Ganancia Neta (€)',
          data: datosTrimestre.map(d => d.gananciaNeta),
          backgroundColor: '#10b981',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { size: 11, weight: '600' } }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: €${ctx.raw.toFixed(2)}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (val) => `€${val}` }
        }
      }
    }
  });
};

// 10. GESTIÓN DE MODALES
window.openModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    if (modalId === 'modalDiario') window.renderCierreDiario();
    if (modalId === 'modalSemanal') window.renderCierreSemanal();
    if (modalId === 'modalMensual') window.renderCierreMensual();
  }
};

window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
};

window.cerrarModalVenta = function() {
  window.closeModal('modalVenta');
};

window.verificarAccesoAdmin = function() {
  let clave = prompt("Ingrese la clave administrativa:");
  if (clave === "admin123") {
    window.openModal('modalAdminOpciones');
    window.cargarListaServiciosAdmin();
    window.cargarListaEspecialistasAdmin();
  } else if (clave !== null) {
    alert("Clave incorrecta. Acceso denegado.");
  }
};

window.cerrarModalAdminOpciones = function() { window.closeModal('modalAdminOpciones'); };
window.abrirModalServicio = function() { window.openModal('modalServicio'); };
window.cerrarModalServicio = function() { window.closeModal('modalServicio'); };
window.abrirModalEspecialista = function() { window.openModal('modalEspecialista'); };
window.cerrarModalEspecialista = function() { window.closeModal('modalEspecialista'); };

// 11. ADMINISTRACIÓN
window.guardarServicio = async function(event) {
  if (event) event.preventDefault();
  const nombre = document.getElementById('inputNombreServicio')?.value.trim();
  const categoria = document.getElementById('inputCategoriaServicio')?.value || 'Uñas';
  const precio = parseFloat(document.getElementById('inputPrecioServicio')?.value || 0);

  if (!nombre) {
    alert("Por favor ingrese el nombre del servicio.");
    return;
  }

  try {
    const { error } = await supabase.from('servicios').insert([{ nombre, categoria, precio_eur: precio }]);
    if (error) throw error;
    alert("¡Servicio guardado con éxito!");
    document.getElementById('formServicio')?.reset();
    window.cerrarModalServicio();
    cargarSelects();
    window.cargarListaServiciosAdmin();
  } catch (err) {
    alert("No se pudo guardar el servicio: " + err.message);
  }
};

window.guardarEspecialista = async function(event) {
  if (event) event.preventDefault();
  const nombre = document.getElementById('inputNombreEspecialista')?.value.trim();
  const comision = parseFloat(document.getElementById('inputComisionEspecialista')?.value || 0);

  if (!nombre) {
    alert("Por favor ingrese el nombre de la especialista.");
    return;
  }

  try {
    const { error } = await supabase.from('especialistas').insert([{ nombre: nombre, porcentaje_comision: comision, activo: true }]);
    if (error) throw error;
    alert("¡Especialista registrada con éxito!");
    document.getElementById('formEspecialista')?.reset();
    window.cerrarModalEspecialista();
    cargarSelects();
    window.cargarListaEspecialistasAdmin();
  } catch (err) {
    alert("No se pudo guardar la especialista: " + err.message);
  }
};

window.cargarListaServiciosAdmin = async function() {
  const container = document.getElementById('listaServiciosAdmin');
  if (!container) return;

  const { data: servicios, error } = await supabase.from('servicios').select('*').order('nombre');
  if (error || !servicios || servicios.length === 0) {
    container.innerHTML = `<p class="p-3 text-slate-400 text-center text-xs">No hay servicios registrados.</p>`;
    return;
  }

  const categoriasFijas = ['Uñas', 'Estilismo', 'Extras'];
  const agrupados = {};
  categoriasFijas.forEach(cat => agrupados[cat] = []);

  servicios.forEach(s => {
    let cat = s.categoria ? s.categoria.trim() : 'Extras';
    cat = cat.charAt(0).toUpperCase() + cat.slice(1).toLowerCase();
    if (!agrupados[cat]) agrupados[cat] = [];
    agrupados[cat].push(s);
  });

  let htmlContent = '';
  Object.keys(agrupados).forEach(categoria => {
    const lista = agrupados[categoria];
    if (lista.length === 0) return;

    htmlContent += `
      <div class="bg-slate-100/80 px-3 py-1.5 font-bold text-slate-700 text-[10px] uppercase tracking-wider border-y border-slate-200 flex items-center justify-between">
        <span>📂 ${categoria}</span>
        <span class="text-slate-400 font-normal">(${lista.length})</span>
      </div>
      <div class="divide-y divide-slate-100 bg-white">
    `;

    lista.forEach(s => {
      const valorPrecio = s.precio_eur !== undefined && s.precio_eur !== null ? s.precio_eur : (s.precio || 0);
      htmlContent += `
        <div class="flex items-center justify-between p-2.5 text-xs hover:bg-slate-50 transition">
          <div class="flex-1 pr-2">
            <p class="font-semibold text-slate-800 capitalize">${s.nombre}</p>
          </div>
          <div class="flex items-center gap-2">
            <div class="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 focus-within:border-slate-900 transition">
              <span class="text-slate-400 font-medium text-xs mr-1">€</span>
              <input type="number" step="0.01" value="${parseFloat(valorPrecio).toFixed(2)}" id="inputPrecio_${s.id}" class="w-16 bg-transparent text-slate-800 font-bold text-xs text-right outline-none"/>
            </div>
            <button onclick="window.actualizarPrecioServicio('${s.id}')" class="bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition" title="Guardar nuevo monto">💾</button>
            <button onclick="window.eliminarServicio('${s.id}')" class="text-rose-500 hover:text-rose-700 font-bold px-1 text-xs" title="Eliminar servicio">✕</button>
          </div>
        </div>
      `;
    });
    htmlContent += `</div>`;
  });

  container.innerHTML = htmlContent;
};

window.actualizarPrecioServicio = async function(idServicio) {
  const input = document.getElementById(`inputPrecio_${idServicio}`);
  if (!input) return;
  const nuevoPrecio = parseFloat(input.value);

  if (isNaN(nuevoPrecio) || nuevoPrecio < 0) {
    alert("Por favor, ingrese un precio válido.");
    return;
  }

  const { error } = await supabase.from('servicios').update({ precio_eur: nuevoPrecio }).eq('id', idServicio);
  if (error) {
    alert("Error al actualizar precio: " + error.message);
  } else {
    input.classList.add('bg-emerald-100', 'text-emerald-800');
    setTimeout(() => { input.classList.remove('bg-emerald-100', 'text-emerald-800'); }, 1000);
    cargarSelects();
  }
};

window.eliminarServicio = async function(idServicio) {
  if (!confirm("¿Está seguro de que desea eliminar este servicio?")) return;
  const { error } = await supabase.from('servicios').delete().eq('id', idServicio);
  if (error) {
    alert("No se pudo eliminar el servicio: " + error.message);
  } else {
    window.cargarListaServiciosAdmin();
    cargarSelects();
  }
};

window.cargarListaEspecialistasAdmin = async function() {
  const container = document.getElementById('listaEspecialistasAdmin');
  if (!container) return;

  const { data: especialistas, error } = await supabase.from('especialistas').select('*').eq('activo', true).order('nombre');
  if (error) {
    container.innerHTML = `<p class="p-3 text-rose-500 text-center text-xs">Error al cargar: ${error.message}</p>`;
    return;
  }

  if (!especialistas || especialistas.length === 0) {
    container.innerHTML = `<p class="p-3 text-slate-400 text-center text-xs">No hay especialistas registradas.</p>`;
    return;
  }

  container.innerHTML = especialistas.map(e => {
    const comisionVal = e.porcentaje_comision !== undefined ? e.porcentaje_comision : 0;
    return `
      <div class="flex items-center justify-between p-2.5 text-xs hover:bg-slate-50 transition border-b border-slate-100 last:border-b-0">
        <div class="flex-1 pr-2">
          <p class="font-bold text-slate-800 capitalize">${e.nombre}</p>
        </div>
        <div class="flex items-center gap-2">
          <div class="flex items-center bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 focus-within:border-slate-900 transition">
            <span class="text-slate-400 font-medium text-xs mr-1">%</span>
            <input type="number" step="0.1" value="${parseFloat(comisionVal).toFixed(0)}" id="inputComision_${e.id}" class="w-12 bg-transparent text-slate-800 font-bold text-xs text-right outline-none"/>
          </div>
          <button onclick="window.actualizarComisionEspecialista('${e.id}')" class="bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition" title="Guardar porcentaje">💾</button>
          <button onclick="window.eliminarEspecialista('${e.id}')" class="text-rose-500 hover:text-rose-700 font-bold text-xs px-1" title="Desactivar especialista">✕</button>
        </div>
      </div>
    `;
  }).join('');
};

window.actualizarComisionEspecialista = async function(idEspecialista) {
  const input = document.getElementById(`inputComision_${idEspecialista}`);
  if (!input) return;
  const nuevaComision = parseFloat(input.value);

  if (isNaN(nuevaComision) || nuevaComision < 0) {
    alert("Por favor, ingrese un porcentaje válido.");
    return;
  }

  const { error } = await supabase.from('especialistas').update({ porcentaje_comision: nuevaComision }).eq('id', idEspecialista);
  if (error) {
    alert("Error al actualizar la comisión: " + error.message);
  } else {
    input.classList.add('bg-emerald-100', 'text-emerald-800');
    setTimeout(() => { input.classList.remove('bg-emerald-100', 'text-emerald-800'); }, 1000);
  }
};

window.eliminarEspecialista = async function(idEspecialista) {
  if (!confirm("¿Está seguro de que desea eliminar esta especialista?")) return;
  const { error } = await supabase.from('especialistas').update({ activo: false }).eq('id', idEspecialista);
  if (error) {
    alert("Error al eliminar: " + error.message);
  } else {
    window.cargarListaEspecialistasAdmin();
    cargarSelects();
  }
};

const todosLosModales = [
  'modalDiario', 'modalSemanal', 'modalMensual', 'modalVenta', 'modalGasto',
  'modalAdminOpciones', 'modalServicio', 'modalEspecialista', 'modalDetalleEspecialista',
  'modalCuentasPendientes', 'modalLiquidarPago'
];

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') todosLosModales.forEach(window.closeModal);
});

window.addEventListener('click', (e) => {
  todosLosModales.forEach(id => {
    const modal = document.getElementById(id);
    if (e.target === modal) window.closeModal(id);
  });
});

// ==========================================
// MÓDULO DE CUENTAS POR COBRAR Y WHATSAPP
// ==========================================

window.cargarCuentasPendientes = async function() {
  const container = document.getElementById('listaCuentasPendientes');
  if (!container) return;

  container.innerHTML = `<p class="p-4 text-center text-slate-400 text-xs">Cargando cuentas pendientes...</p>`;

  const { data: ventasPendientes, error } = await supabase
    .from('ventas_diarias')
    .select(`*, servicios (nombre), especialistas (nombre)`)
    .eq('estado_pago', 'Por Cobrar')
    .order('fecha', { ascending: false });

  if (error) {
    container.innerHTML = `<p class="p-4 text-center text-rose-500 text-xs">Error al cargar pendientes: ${error.message}</p>`;
    return;
  }

  if (!ventasPendientes || ventasPendientes.length === 0) {
    container.innerHTML = `<div class="p-6 text-center text-emerald-600 font-medium text-xs">🎉 ¡Excelente! No hay cuentas por cobrar pendientes.</div>`;
    return;
  }

  let html = '';
  ventasPendientes.forEach(v => {
    const fecha = new Date(v.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const servicio = v.servicios ? v.servicios.nombre : 'Servicio';
    const especialista = v.especialistas ? v.especialistas.nombre : 'Especialista';
    const montoEur = parseFloat(v.monto_eur || 0);
    const montoBs = montoEur * (tasaActual || 0);
    const mensajeWA = construirMensajeWhatsApp(v, tasaActual);

    html += `
      <div class="p-3.5 bg-slate-50 border border-amber-200 rounded-xl flex flex-col gap-2 hover:border-amber-400 transition">
        <div class="flex justify-between items-start">
          <div>
            <h4 class="font-bold text-slate-800 text-sm capitalize">${v.nombre_clienta}</h4>
            <p class="text-[11px] text-slate-500">${servicio} • 💆‍♀️ ${especialista} • 📅 ${fecha}</p>
          </div>
          <div class="text-right">
            <span class="text-amber-700 font-extrabold text-sm block">€${montoEur.toFixed(2)}</span>
            <span class="text-[10px] text-slate-500 block">${montoBs.toLocaleString('es-VE', {minimumFractionDigits: 2})} Bs</span>
          </div>
        </div>
        <div class="flex gap-2 mt-1 border-t border-slate-200/60 pt-2">
          <a href="https://wa.me/?text=${mensajeWA}" target="_blank" class="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-[11px] py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition">💬 Recordar por WhatsApp</a>
          <button onclick="window.prepararLiquidarPago('${v.id}', '${v.nombre_clienta}', ${montoEur})" class="bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] py-1.5 px-3 rounded-lg transition">✅ Registrar Pago</button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
};

window.prepararLiquidarPago = function(ventaId, cliente, montoEur) {
  document.getElementById('liquidarVentaId').value = ventaId;
  document.getElementById('liquidarClienteLabel').textContent = cliente;
  document.getElementById('liquidarMontoLabel').textContent = `€${parseFloat(montoEur).toFixed(2)}`;
  window.openModal('modalLiquidarPago');
};

window.procesarLiquidarPago = async function(e) {
  e.preventDefault();
  const ventaId = document.getElementById('liquidarVentaId').value;
  const metodoPago = document.getElementById('liquidarMetodoPago').value;
  const referencia = document.getElementById('liquidarReferencia').value;

  const { error } = await supabase
    .from('ventas_diarias')
    .update({ estado_pago: 'Pagado', metodo_pago: metodoPago, referencia_pago: referencia, fecha_pago: new Date().toISOString() })
    .eq('id', ventaId);

  if (error) {
    alert("Error al actualizar la cuenta: " + error.message);
  } else {
    alert("¡Pago registrado correctamente!");
    window.closeModal('modalLiquidarPago');
    window.cargarCuentasPendientes();
    if (typeof cargarVentasDia === 'function') cargarVentasDia();
  }
};

function construirMensajeWhatsApp(venta, tasa) {
  const montoEur = parseFloat(venta.monto_eur || 0).toFixed(2);
  const montoBs = (montoEur * tasa).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const servicioNombre = venta.servicios ? venta.servicios.nombre : 'Servicio de belleza';
  const texto = `Hola ${venta.nombre_clienta} 👋✨ Esperamos que te encuentres muy bien.\n\nTe escribimos de *Moon Spa Lecheria* para recordarte el pago pendiente de tu servicio *${servicioNombre}* por un monto de *€${montoEur}* (equivalente a *${montoBs} Bs* a la tasa BCV del día).\n\nSi ya realizaste el pago, por favor compártenos el comprobante por este medio. ¡Muchas gracias! 💕`;
  return encodeURIComponent(texto);
}

// ==========================================
// MÓDULO CONTROL Y ABONOS OLIVETTA ($USD)
// ==========================================

window.abrirModalOlivetta = function() {
  window.openModal('modalOlivetta');
  window.cargarResumenOlivetta();
};

window.cargarResumenOlivetta = async function() {
  const { data: ventas } = await supabase.from('ventas_diarias').select('monto_olivetta_usd');
  const totalConsumido = (ventas || []).reduce((acc, v) => acc + (parseFloat(v.monto_olivetta_usd) || 0), 0);

  const { data: abonos, error: errAbonos } = await supabase.from('abonos_olivetta').select('*').order('fecha', { ascending: false });
  const totalAbonado = (abonos || []).reduce((acc, a) => acc + (parseFloat(a.monto_usd) || 0), 0);
  const saldoPendiente = totalConsumido - totalAbonado;

  const elConsumido = document.getElementById('olivettaTotalConsumido');
  const elAbonado = document.getElementById('olivettaTotalAbonado');
  const elPendiente = document.getElementById('olivettaSaldoPendiente');

  if (elConsumido) elConsumido.textContent = `$${totalConsumido.toFixed(2)} USD`;
  if (elAbonado) elAbonado.textContent = `$${totalAbonado.toFixed(2)} USD`;
  if (elPendiente) elPendiente.textContent = `$${saldoPendiente.toFixed(2)} USD`;

  const tbody = document.getElementById('tablaAbonosOlivettaBody');
  if (!tbody) return;

  if (errAbonos || !abonos || abonos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="p-3 text-center text-slate-400">No se han registrado abonos a Olivetta aún.</td></tr>`;
    return;
  }

  tbody.innerHTML = abonos.map(a => {
    const f = new Date(a.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `
      <tr class="hover:bg-slate-50 border-b">
        <td class="p-2 font-medium">${f}</td>
        <td class="p-2">${a.metodo_pago || 'Cash'}</td>
        <td class="p-2 text-slate-500">${a.referencia || '-'}</td>
        <td class="p-2 text-right font-bold text-emerald-600">$${parseFloat(a.monto_usd || 0).toFixed(2)}</td>
      </tr>
    `;
  }).join('');
};

window.registrarAbonoOlivetta = async function(e) {
  e.preventDefault();
  const montoUsd = parseFloat(document.getElementById('montoAbonoOlivetta').value) || 0;
  const metodoPago = document.getElementById('metodoAbonoOlivetta').value;
  const referencia = document.getElementById('referenciaAbonoOlivetta').value;

  if (montoUsd <= 0) {
    alert("Por favor ingrese un monto de abono válido.");
    return;
  }

  const { error } = await supabase.from('abonos_olivetta').insert([{
    monto_usd: montoUsd,
    metodo_pago: metodoPago,
    referencia: referencia,
    fecha: new Date().toISOString()
  }]);

  if (error) {
    alert("Error al registrar abono: " + error.message);
  } else {
    alert("¡Abono a Olivetta registrado con éxito!");
    document.getElementById('montoAbonoOlivetta').value = '';
    document.getElementById('referenciaAbonoOlivetta').value = '';
    window.cargarResumenOlivetta();
    if (typeof renderCierreSemanal === 'function') renderCierreSemanal();
  }
};