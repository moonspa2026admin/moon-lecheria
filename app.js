import { supabase } from './supabaseClient.js';

// Variables globales de estado
let tasaActual = 0;
let serviciosData = [];
let especialistasData = [];
let ventasHoyCache = [];

// INICIALIZACIÓN
document.addEventListener('DOMContentLoaded', async () => {
  const hoyStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fechaLabel = document.getElementById('fechaActualLabel');
  if (fechaLabel) fechaLabel.textContent = hoyStr;

  await cargarTasaBcvEnLinea();
  await cargarSelects();
  await cargarVentasDia();

  // Event Listeners
  document.getElementById('montoEur')?.addEventListener('input', calcularBolivares);
  document.getElementById('selectServicio')?.addEventListener('change', autocompletarPrecioServicio);
  document.getElementById('formVenta')?.addEventListener('submit', registrarVenta);
});

// 1. TASA OFICIAL EURO BCV (FILTRADO EXCLUSIVO DE EURO)
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

// 7. CIERRE SEMANAL DINÁMICO
window.renderCierreSemanal = async function() {
  const tbody = document.getElementById('tablaNominaSemanal');
  const elIngresosArea = document.getElementById('ingresosPorAreaContainer');
  const elDistribucionPago = document.getElementById('distribucionPagosContainer');
  const elBalanceSemanal = document.getElementById('balanceNetoSemanalVal');
  const elCuentasPendientes = document.getElementById('cuentasPendientesSemanalVal');

  if (!tbody) return;

  const ahora = new Date();
  const primerDiaSemana = new Date(ahora.setDate(ahora.getDate() - ahora.getDay() + 1));
  primerDiaSemana.setHours(0,0,0,0);

  const { data: ventasSemana } = await supabase
    .from('ventas_diarias')
    .select(`*, servicios(nombre, categoria), especialistas(nombre, porcentaje_comision)`)
    .gte('fecha', primerDiaSemana.toISOString());

  const { data: gastosSemana } = await supabase
    .from('gastos_operativos')
    .select('*')
    .gte('fecha', primerDiaSemana.toISOString());

  const ventas = ventasSemana || [];
  const gastos = gastosSemana || [];
  const especialistas = window.especialistas || [];

  let htmlTabla = '';
  let totalComisionesYPropinasSemana = 0;

  especialistas.forEach(esp => {
    const ventasEsp = ventas.filter(v => (v.especialistas ? v.especialistas.nombre : '') === esp.nombre);
    
    const totalVendidoEur = ventasEsp.reduce((acc, v) => acc + (parseFloat(v.monto_eur) || 0), 0);
    const totalPropinasEur = ventasEsp.reduce((acc, v) => acc + (parseFloat(v.propina_eur) || 0), 0);
    
    const pctComision = parseFloat(esp.porcentaje_comision) || 40;
    const totalComisionEur = (totalVendidoEur * pctComision) / 100;
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

  tbody.innerHTML = htmlTabla || `<tr><td colspan="6" class="p-4 text-center text-slate-400">Sin datos esta semana.</td></tr>`;

  const ingresosPorCategoria = {};
  let totalVentasSemanaEur = 0;
  let cuentasPendientes = 0;

  ventas.forEach(v => {
    const cat = (v.servicios && v.servicios.categoria) ? v.servicios.categoria : 'General';
    const monto = parseFloat(v.monto_eur) || 0;
    ingresosPorCategoria[cat] = (ingresosPorCategoria[cat] || 0) + monto;
    totalVentasSemanaEur += monto;

    if (v.estado_pago === 'Por Cobrar') {
      cuentasPendientes += monto;
    }
  });

  if (elIngresosArea) {
    elIngresosArea.innerHTML = Object.entries(ingresosPorCategoria).map(([cat, monto]) => `
      <div class="flex justify-between text-xs font-semibold text-slate-700 py-1">
        <span>${cat}:</span>
        <span>€${monto.toFixed(2)}</span>
      </div>
    `).join('') || '<p class="text-xs text-slate-400">Sin registros</p>';
  }

  const distribucionPagos = {};

  ventas.forEach(v => {
    const metodo = v.metodo_pago || 'Otros';
    const montoEur = parseFloat(v.monto_eur) || 0;
    const montoBs = parseFloat(v.monto_ves) || 0;

    if (!distribucionPagos[metodo]) {
      distribucionPagos[metodo] = { eur: 0, bs: 0 };
    }
    distribucionPagos[metodo].eur += montoEur;
    distribucionPagos[metodo].bs += montoBs;
  });

  if (elDistribucionPago) {
    elDistribucionPago.innerHTML = Object.entries(distribucionPagos).map(([metodo, totales]) => {
      const esMonedaNacional = metodo.includes('Pago Móvil') || metodo.includes('Punto de Venta') || metodo.includes('PDV');
      const valorMostrar = esMonedaNacional 
        ? `${totales.bs.toLocaleString('es-VE', {minimumFractionDigits: 2})} Bs` 
        : `€${totales.eur.toFixed(2)}`;

      return `
        <div class="flex justify-between text-xs font-semibold text-slate-700 py-1 border-b border-slate-100 last:border-b-0">
          <span>💳 ${metodo}:</span>
          <span class="font-bold">${valorMostrar}</span>
        </div>
      `;
    }).join('') || '<p class="text-xs text-slate-400">Sin transacciones registradas</p>';
  }

  const totalGastosSemanaEur = gastos.reduce((acc, g) => acc + (parseFloat(g.monto_eur) || 0), 0);
  const balanceNeto = totalVentasSemanaEur - totalComisionesYPropinasSemana - totalGastosSemanaEur;

  if (elBalanceSemanal) elBalanceSemanal.textContent = `€${balanceNeto.toFixed(2)}`;
  if (elCuentasPendientes) elCuentasPendientes.textContent = `Cuentas por Cobrar Pendientes: €${cuentasPendientes.toFixed(2)}`;

  // 1. Totalizar consumos de Olivetta en la semana
  const totalOlivettaSemanaUsd = ventas.reduce((acc, v) => acc + (parseFloat(v.monto_olivetta_usd) || 0), 0);

  // 2. Renderizar tarjeta o fila de resumen para Olivetta
  const elOlivettaContainer = document.getElementById('totalOlivettaSemanalVal');
  if (elOlivettaContainer) {
    elOlivettaContainer.textContent = `$${totalOlivettaSemanaUsd.toFixed(2)} USD`;
  }
};

// 8. CIERRE MENSUAL DINÁMICO
window.renderCierreMensual = async function() {
  const elIngresosTotales = document.getElementById('mensualIngresosTotales');
  const elNominaComisiones = document.getElementById('mensualNominaComisiones');
  const elGastosOperativos = document.getElementById('mensualGastosOperativos');
  const elGananciaNeta = document.getElementById('mensualGananciaNeta');

  const ahora = new Date();
  const primerDiaMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString();

  const { data: ventasMes } = await supabase
    .from('ventas_diarias')
    .select(`*, especialistas(porcentaje_comision)`)
    .gte('fecha', primerDiaMes);

  const { data: gastosMes } = await supabase
    .from('gastos_operativos')
    .select('*')
    .gte('fecha', primerDiaMes);

  const ventas = ventasMes || [];
  const gastos = gastosMes || [];

  let ingresosTotales = 0;
  let nominaComisionesTotales = 0;

  ventas.forEach(v => {
    const monto = parseFloat(v.monto_eur) || 0;
    const propina = parseFloat(v.propina_eur) || 0;
    const pctComision = v.especialistas ? parseFloat(v.especialistas.porcentaje_comision) : 40;

    ingresosTotales += monto;
    nominaComisionesTotales += ((monto * pctComision) / 100) + propina;
  });

  const gastosTotales = gastos.reduce((acc, g) => acc + (parseFloat(g.monto_eur) || 0), 0);
  const gananciaNeta = ingresosTotales - nominaComisionesTotales - gastosTotales;

  if (elIngresosTotales) elIngresosTotales.textContent = `€${ingresosTotales.toFixed(2)}`;
  if (elNominaComisiones) elNominaComisiones.textContent = `€${nominaComisionesTotales.toFixed(2)}`;
  if (elGastosOperativos) elGastosOperativos.textContent = `€${gastosTotales.toFixed(2)}`;
  if (elGananciaNeta) elGananciaNeta.textContent = `€${gananciaNeta.toFixed(2)}`;
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

// Cargar porcentaje automático al seleccionar especialista
window.alCambiarEspecialista = function() {
  const selectEspecialista = document.getElementById('selectEspecialista');
  const inputPorcentaje = document.getElementById('porcentajeComision');
  if (!selectEspecialista || !inputPorcentaje) return;

  const especialistaId = selectEspecialista.value;
  if (!especialistaId) {
    inputPorcentaje.value = '';
    return;
  }

  const especialista = especialistasData.find(e => e.id == especialistaId);
  if (especialista) {
    inputPorcentaje.value = especialista.porcentaje_comision || 50;
  }
};

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
  const montoEurInput = document.getElementById('montoEur');
  if (!montoEurInput) return;
  const montoEur = parseFloat(montoEurInput.value) || 0;
  const montoBs = montoEur * tasaActual;
  const montoInput = document.getElementById('montoBvInput');
  if (montoInput) {
    montoInput.value = montoBs > 0 ? `${montoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs` : '0.00 Bs';
  }
}

// 4. REGISTRAR VENTA
async function registrarVenta(e) {
  e.preventDefault();

  const fechaInput = document.getElementById('fechaVenta')?.value;
  const fechaSeleccionada = fechaInput ? new Date(fechaInput).toISOString() : new Date().toISOString();

  const nombreClienta = document.getElementById('nombreClienta').value;
  const servicioId = document.getElementById('selectServicio').value;
  const especialistaId = document.getElementById('selectEspecialista').value;
  const porcentajeComision = parseFloat(document.getElementById('porcentajeComision')?.value) || 0;
  const montoEur = parseFloat(document.getElementById('montoEur').value) || 0;
  const metodoPago = document.getElementById('metodoPago').value;
  const referenciaPago = document.getElementById('referenciaPago').value;
  const propinaEur = parseFloat(document.getElementById('propinaEur').value) || 0;
  const estadoPago = document.getElementById('estadoPago').value;
  const montoOlivettaUsd = parseFloat(document.getElementById('montoOlivettaUsd')?.value) || 0;

  const montoVes = montoEur * tasaActual;

  const nuevaVenta = {
    fecha: fechaSeleccionada,
    nombre_clienta: nombreClienta,
    servicio_id: servicioId,
    especialista_id: especialistaId,
    porcentaje_comision: porcentajeComision,
    monto_eur: montoEur,
    tasa_aplicada: tasaActual,
    monto_ves: montoVes,
    metodo_pago: metodoPago,
    referencia_pago: referenciaPago,
    propina_eur: propinaEur,
    estado_pago: estadoPago,
    monto_olivetta_usd: montoOlivettaUsd
  };

  const { error } = await supabase.from('ventas_diarias').insert([nuevaVenta]);

  if (error) {
    alert("Error al registrar la venta: " + error.message);
  } else {
    alert("¡Venta registrada con éxito!");
    document.getElementById('formVenta').reset();
    if (document.getElementById('montoBvInput')) {
      document.getElementById('montoBvInput').value = '0.00 Bs';
    }
    window.cerrarModalVenta();
    cargarVentasDia();
  }
}

// 5. CARGAR VENTAS DEL DÍA Y DIBUJAR TARJETAS
async function cargarVentasDia() {
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
    totalEur += parseFloat(v.monto_eur || 0);
    totalBs += parseFloat(v.monto_ves || 0);

    const espNombre = v.especialistas ? v.especialistas.nombre : 'General';
    const porcentaje = v.especialistas ? parseFloat(v.especialistas.porcentaje_comision) : 40;
    
    if (!comisionesPorEsp[espNombre]) {
      comisionesPorEsp[espNombre] = { totalVentas: 0, comision: 0, porcentaje };
    }
    comisionesPorEsp[espNombre].totalVentas += parseFloat(v.monto_eur || 0);
    comisionesPorEsp[espNombre].comision += parseFloat(v.monto_eur || 0) * (porcentaje / 100);

    const badgeEstado = v.estado_pago === 'Pagado' 
      ? '<span class="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-medium">Pagado</span>'
      : '<span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">Por Cobrar</span>';

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100">
        <td class="p-3 font-semibold text-slate-800 capitalize">${v.nombre_clienta}</td>
        <td class="p-3">${v.servicios ? v.servicios.nombre : 'N/A'}</td>
        <td class="p-3 font-medium text-slate-600">${espNombre}</td>
        <td class="p-3 font-bold text-slate-900">€${parseFloat(v.monto_eur || 0).toFixed(2)} <span class="text-[10px] text-slate-400 block">${parseFloat(v.monto_ves || 0).toLocaleString('es-VE', {minimumFractionDigits:2})} Bs</span></td>
        <td class="p-3">${v.metodo_pago} <span class="text-[10px] text-slate-400 block">${v.referencia_pago || ''}</span></td>
        <td class="p-3">${badgeEstado}</td>
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
            <span class="flex items-center gap-1.5 capitalize">👩‍🎨 ${esp} <span class="text-[10px] text-slate-400 font-normal">(Toca para ver)</span></span>
            <span class="text-emerald-600 font-extrabold">Comisión (${info.porcentaje}%): €${info.comision.toFixed(2)}</span>
          </div>
          <p class="text-[11px] text-slate-500">Total servicios recaudados: €${info.totalVentas.toFixed(2)}</p>
        </div>
      `;
    }
  }
}

// 6. DETALLE POR ESPECIALISTA (MODAL TÁCTIL)
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
  let pctComision = serviciosEsp[0].especialistas ? parseFloat(serviciosEsp[0].especialistas.porcentaje_comision) : 40;

  if (modalSubtitulo) {
    modalSubtitulo.textContent = `${serviciosEsp.length} servicio(s) realizado(s) hoy (Comisión: ${pctComision}%)`;
  }

  tbody.innerHTML = '';
  serviciosEsp.forEach(s => {
    const monto = parseFloat(s.monto_eur || 0);
    const propina = parseFloat(s.propina_eur || 0);
    const comisionUnit = monto * (pctComision / 100);

    totalRecaudado += monto;
    totalComisiones += comisionUnit;
    totalPropinas += propina;

    tbody.innerHTML += `
      <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-xs">
        <td class="p-3 font-semibold text-slate-800 capitalize">${s.nombre_clienta || 'S/N'}</td>
        <td class="p-3 font-medium">${s.servicios ? s.servicios.nombre : 'Servicio'}</td>
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

// 7. CORRECCIÓN DE TOTALES EN CIERRE DIARIO
window.renderCierreDiario = function() {
  const tbody = document.getElementById('tablaServiciosDiarios');
  const listaComisiones = document.getElementById('listaComisiones');
  const elFechaDiario = document.getElementById('fechaDiario');
  const elTotalRecaudado = document.getElementById('cierreTotalRecaudado');
  const elCierreCaja = document.getElementById('cierreCajaFinal');
  
  if (!tbody) return;

  const hoyLocal = new Date();
  const hoyIsoStr = hoyLocal.getFullYear() + '-' + String(hoyLocal.getMonth() + 1).padStart(2, '0') + '-' + String(hoyLocal.getDate()).padStart(2, '0');

  if (elFechaDiario) {
    elFechaDiario.textContent = `Resumen al ${hoyLocal.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
  }

  const ventasHoy = (window.ventas || []).filter(v => {
    const fv = v.fecha ? v.fecha.split('T')[0] : hoyIsoStr;
    return fv === hoyIsoStr;
  });

  if (ventasHoy.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No se han registrado ventas hoy.</td></tr>`;
    if (listaComisiones) listaComisiones.innerHTML = '<li class="text-slate-400">• Sin comisiones ni propinas hoy</li>';
    if (elTotalRecaudado) elTotalRecaudado.textContent = '0.00 €';
    if (elCierreCaja) elCierreCaja.textContent = '0.00 €';
    return;
  }

  let totalRecaudadoDia = 0;
  let totalComisionesYPropinasPagar = 0;

  tbody.innerHTML = ventasHoy.map((v, index) => {
    const propina = parseFloat(v.propina_eur) || 0;
    const servicioNombre = v.servicios ? v.servicios.nombre : '-';
    const espNombre = v.especialistas ? v.especialistas.nombre : 'Sin Asignar';
    const montoEur = parseFloat(v.monto_eur) || 0;
    const montoBs = parseFloat(v.monto_ves) || 0;

    totalRecaudadoDia += montoEur;

    return `
      <tr class="border-b hover:bg-slate-50 text-xs">
        <td class="p-2 font-semibold text-slate-500">${index + 1}</td>
        <td class="p-2 font-medium capitalize">${v.nombre_clienta || 'S/N'}</td>
        <td class="p-2">${servicioNombre}</td>
        <td class="p-2 font-semibold">${espNombre}</td>
        <td class="p-2 font-semibold">${montoEur.toFixed(2)} € ${propina > 0 ? `<span class="text-emerald-600 text-[10px] block">(+${propina.toFixed(2)}€ propina)</span>` : ''}</td>
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
    const pct = v.especialistas ? parseFloat(v.especialistas.porcentaje_comision) : 40;

    if (!acumuladoProf[prof]) {
      acumuladoProf[prof] = { totalServicios: 0, propinas: 0, pct: pct };
    }
    acumuladoProf[prof].totalServicios += monto;
    acumuladoProf[prof].propinas += propina;
  });

  if (listaComisiones) {
    let htmlComisiones = '';

    Object.keys(acumuladoProf).forEach(p => {
      const item = acumuladoProf[p];
      const pagoComision = (item.totalServicios * item.pct) / 100;
      const totalAPagar = pagoComision + item.propinas;
      totalComisionesYPropinasPagar += totalAPagar;

      htmlComisiones += `
        <li class="mb-1">• <strong>${p}:</strong> 
          ${item.totalServicios.toFixed(2)} € (${item.pct}%) = ${pagoComision.toFixed(2)} € 
          ${item.propinas > 0 ? `<span class="text-amber-600 font-semibold">+ ${item.propinas.toFixed(2)} € propina</span>` : ''}
          ➡ <span class="font-extrabold text-emerald-600">Total: ${totalAPagar.toFixed(2)} €</span>
        </li>`;
    });

    listaComisiones.innerHTML = htmlComisiones;
  }

  const saldoNetoCaja = totalRecaudadoDia - totalComisionesYPropinasPagar;

  if (elTotalRecaudado) elTotalRecaudado.textContent = `${totalRecaudadoDia.toFixed(2)} €`;
  if (elCierreCaja) elCierreCaja.textContent = `${saldoNetoCaja.toFixed(2)} €`;
};

// 8. GESTIÓN DE MODALES
window.openModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    if (modalId === 'modalDiario') window.renderCierreDiario();
    if (modalId === 'modalSemanal') window.renderCierreSemanal();
  }
};

window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
};

window.abrirModalVenta = function() {
  window.openModal('modalVenta');
  cargarSelects();

  // Asigna la fecha actual por defecto si no se ha elegido ninguna
  const fechaInput = document.getElementById('fechaVenta');
  if (fechaInput && !fechaInput.value) {
    const hoy = new Date().toISOString().split('T')[0];
    fechaInput.value = hoy;
  }
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

window.cerrarModalAdminOpciones = function() {
  window.closeModal('modalAdminOpciones');
};

window.abrirModalServicio = function() {
  window.openModal('modalServicio');
};

window.cerrarModalServicio = function() {
  window.closeModal('modalServicio');
};

window.abrirModalEspecialista = function() {
  window.openModal('modalEspecialista');
};

window.cerrarModalEspecialista = function() {
  window.closeModal('modalEspecialista');
};

// 9. ADMINISTRACIÓN DE SERVICIOS Y ESPECIALISTAS
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
    const { error } = await supabase
      .from('servicios')
      .insert([{ nombre, categoria, precio_eur: precio }]);

    if (error) throw error;

    alert("¡Servicio guardado con éxito!");
    document.getElementById('formServicio')?.reset();
    window.cerrarModalServicio();

    cargarSelects();
    window.cargarListaServiciosAdmin();
  } catch (err) {
    console.error("Error al guardar servicio:", err);
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
    const { error } = await supabase
      .from('especialistas')
      .insert([{ 
        nombre: nombre, 
        porcentaje_comision: comision, 
        activo: true 
      }]);

    if (error) throw error;

    alert("¡Especialista registrada con éxito!");
    document.getElementById('formEspecialista')?.reset();
    window.cerrarModalEspecialista();

    cargarSelects();
    window.cargarListaEspecialistasAdmin();
  } catch (err) {
    console.error("Error al guardar especialista:", err);
    alert("No se pudo guardar la especialista: " + err.message);
  }
};

window.cargarListaServiciosAdmin = async function() {
  const container = document.getElementById('listaServiciosAdmin');
  if (!container) return;

  const { data: servicios, error } = await supabase
    .from('servicios')
    .select('*')
    .order('nombre');

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
              <input 
                type="number" 
                step="0.01" 
                value="${parseFloat(valorPrecio).toFixed(2)}" 
                id="inputPrecio_${s.id}"
                class="w-16 bg-transparent text-slate-800 font-bold text-xs text-right outline-none"
              />
            </div>

            <button 
              onclick="window.actualizarPrecioServicio('${s.id}')" 
              class="bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition"
              title="Guardar nuevo monto"
            >
              💾
            </button>

            <button 
              onclick="window.eliminarServicio('${s.id}')" 
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

  const { error } = await supabase
    .from('servicios')
    .update({ precio_eur: nuevoPrecio })
    .eq('id', idServicio);

  if (error) {
    alert("Error al actualizar precio: " + error.message);
  } else {
    input.classList.add('bg-emerald-100', 'text-emerald-800');
    setTimeout(() => {
      input.classList.remove('bg-emerald-100', 'text-emerald-800');
    }, 1000);
    cargarSelects();
  }
};

window.eliminarServicio = async function(idServicio) {
  if (!confirm("¿Está seguro de que desea eliminar este servicio?")) return;

  const { error } = await supabase
    .from('servicios')
    .delete()
    .eq('id', idServicio);

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

  const { data: especialistas, error } = await supabase
    .from('especialistas')
    .select('*')
    .eq('activo', true)
    .order('nombre');

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
            <input 
              type="number" 
              step="0.1" 
              value="${parseFloat(comisionVal).toFixed(0)}" 
              id="inputComision_${e.id}"
              class="w-12 bg-transparent text-slate-800 font-bold text-xs text-right outline-none"
            />
          </div>

          <button 
            onclick="window.actualizarComisionEspecialista('${e.id}')" 
            class="bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition"
            title="Guardar porcentaje"
          >
            💾
          </button>

          <button 
            onclick="window.eliminarEspecialista('${e.id}')" 
            class="text-rose-500 hover:text-rose-700 font-bold text-xs px-1"
            title="Desactivar especialista"
          >
            ✕
          </button>
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

  const { error } = await supabase
    .from('especialistas')
    .update({ porcentaje_comision: nuevaComision })
    .eq('id', idEspecialista);

  if (error) {
    alert("Error al actualizar la comisión: " + error.message);
  } else {
    input.classList.add('bg-emerald-100', 'text-emerald-800');
    setTimeout(() => {
      input.classList.remove('bg-emerald-100', 'text-emerald-800');
    }, 1000);
  }
};

window.eliminarEspecialista = async function(idEspecialista) {
  if (!confirm("¿Está seguro de que desea eliminar esta especialista?")) return;

  const { error } = await supabase
    .from('especialistas')
    .update({ activo: false })
    .eq('id', idEspecialista);

  if (error) {
    alert("Error al eliminar: " + error.message);
  } else {
    window.cargarListaEspecialistasAdmin();
    cargarSelects();
  }
};

// 10. LISTENERS TECLADO Y CLIC FUERA
const todosLosModales = [
  'modalDiario', 
  'modalSemanal', 
  'modalMensual', 
  'modalVenta', 
  'modalGasto',
  'modalAdminOpciones', 
  'modalServicio', 
  'modalEspecialista', 
  'modalDetalleEspecialista',
  'modalCuentasPendientes',
  'modalLiquidarPago'
];

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    todosLosModales.forEach(window.closeModal);
  }
});

window.addEventListener('click', (e) => {
  todosLosModales.forEach(id => {
    const modal = document.getElementById(id);
    if (e.target === modal) {
      window.closeModal(id);
    }
  });
});

// ==========================================
// MÓDULO DE CUENTAS POR COBRAR Y WHATSAPP
// ==========================================

// 1. Cargar y renderizar la lista de clientes pendientes
window.cargarCuentasPendientes = async function() {
  const container = document.getElementById('listaCuentasPendientes');
  if (!container) return;

  container.innerHTML = `<p class="p-4 text-center text-slate-400 text-xs">Cargando cuentas pendientes...</p>`;

  const { data: ventasPendientes, error } = await supabase
    .from('ventas_diarias')
    .select(`
      *,
      servicios (nombre),
      especialistas (nombre)
    `)
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
          <!-- Botón de Recordatorio por WhatsApp -->
          <a 
            href="https://wa.me/?text=${mensajeWA}" 
            target="_blank" 
            class="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-[11px] py-1.5 px-3 rounded-lg flex items-center justify-center gap-1.5 transition"
          >
            💬 Recordar por WhatsApp
          </a>

          <!-- Botón para Saldar/Liquidar la Deuda -->
          <button 
            onclick="window.prepararLiquidarPago('${v.id}', '${v.nombre_clienta}', ${montoEur})" 
            class="bg-slate-900 hover:bg-slate-800 text-white font-bold text-[11px] py-1.5 px-3 rounded-lg transition"
          >
            ✅ Registrar Pago
          </button>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
};

// 2. Preparar el modal de cobro para una venta específica
window.prepararLiquidarPago = function(ventaId, cliente, montoEur) {
  document.getElementById('liquidarVentaId').value = ventaId;
  document.getElementById('liquidarClienteLabel').textContent = cliente;
  document.getElementById('liquidarMontoLabel').textContent = `€${parseFloat(montoEur).toFixed(2)}`;
  
  window.openModal('modalLiquidarPago');
};

// 3. Confirmar y procesar la liquidación en Supabase
window.procesarLiquidarPago = async function(e) {
  e.preventDefault();

  const ventaId = document.getElementById('liquidarVentaId').value;
  const metodoPago = document.getElementById('liquidarMetodoPago').value;
  const referencia = document.getElementById('liquidarReferencia').value;

  const { error } = await supabase
    .from('ventas_diarias')
    .update({
      estado_pago: 'Pagado',
      metodo_pago: metodoPago,
      referencia_pago: referencia,
      fecha_pago: new Date().toISOString()
    })
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

  const texto = `Hola ${venta.nombre_clienta} 👋✨ Esperamos que te encuentres muy bien.\n\nTe escribimos de *Olivetta* para recordarte el pago pendiente de tu servicio *${servicioNombre}* por un monto de *€${montoEur}* (equivalente a *${montoBs} Bs* a la tasa BCV del día).\n\nSi ya realizaste el pago, por favor compártenos el comprobante por este medio. ¡Muchas gracias! 💕`;

  return encodeURIComponent(texto);
}