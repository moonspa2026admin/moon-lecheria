import { supabase } from './supabaseClient.js';

// Variables globales de estado
let tasaActual = 0;
let serviciosData = [];

document.addEventListener('DOMContentLoaded', async () => {
  const hoyStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fechaLabel = document.getElementById('fechaActualLabel');
  if (fechaLabel) fechaLabel.textContent = hoyStr;

  await cargarTasaBcv();
  await cargarSelects();
  await cargarVentasDia();

  // Event Listeners
  document.getElementById('btnGuardarTasa')?.addEventListener('click', guardarTasaBcv);
  document.getElementById('montoEur')?.addEventListener('input', calcularBolivares);
  document.getElementById('selectServicio')?.addEventListener('change', autocompletarPrecioServicio);
  document.getElementById('formVenta')?.addEventListener('submit', registrarVenta);
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
      const inputTasa = document.getElementById('inputTasaBcv');
      if (inputTasa) inputTasa.value = tasaActual;
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
    const selectEsp = document.getElementById('selectEspecialista');
    if (selectEsp) {
      selectEsp.innerHTML = '<option value="">Selecciona especialista...</option>';
      esps.forEach(e => {
        selectEsp.innerHTML += `<option value="${e.id}" data-comision="${e.porcentaje_comision}">${e.nombre}</option>`;
      });
    }
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
  const montoInput = document.getElementById('montoBvInput');
  if (montoInput) {
    montoInput.value = montoBs > 0 ? `${montoBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Bs` : '0.00 Bs';
  }
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
    window.cerrarModalVenta();
    cargarVentasDia();
  }
}

// 5. CARGAR VENTAS DEL DÍA Y CALCULAR CIERRES
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

// GESTIÓN DE MODALES (EXPOSICIÓN GLOBAL)
window.openModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('hidden');
};

window.closeModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('hidden');
};

window.abrirModalVenta = function() {
  window.openModal('modalVenta');
  cargarSelects();
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

// ADMINISTRACIÓN DE SERVICIOS Y ESPECIALISTAS
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

// LISTENERS DE TECLADO Y CLIC FUERA DEL MODAL
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    ['modalDiario', 'modalSemanal', 'modalMensual', 'modalVenta', 'modalAdminOpciones', 'modalServicio', 'modalEspecialista'].forEach(window.closeModal);
  }
});

window.addEventListener('click', (e) => {
  ['modalDiario', 'modalSemanal', 'modalMensual', 'modalVenta', 'modalAdminOpciones', 'modalServicio', 'modalEspecialista'].forEach(id => {
    const modal = document.getElementById(id);
    if (e.target === modal) {
      window.closeModal(id);
    }
  });
});