const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

// --- FUNCIONES DE SOPORTE ---

async function obtenerVendedores() {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [rows] = await conn.execute('SELECT DISTINCT nombre FROM tab_vendedores WHERE activo = "si" ORDER BY nombre ASC');
        return rows;
    } catch (e) { return []; } finally { if (conn) await conn.end(); }
}

async function obtenerZonas() {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const [rows] = await conn.execute('SELECT DISTINCT zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) { return []; } finally { if (conn) await conn.end(); }
}

// --- CONSULTA PRINCIPAL ACTUALIZADA ---

async function obtenerListaDeudores(filtros = {}) {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const minDias = filtros.dias || 0;
        const vendedor = filtros.vendedor || '';
        const zona = filtros.zona || '';

        // Se agregaron campos: apellidos y porcentaje
        let sql = `
            SELECT celular, nombres, apellidos, nro_factura, total, abono_factura, porcentaje,
                   (total - abono_factura) AS saldo_usd,
                   fecha_reg, vendedor as vendedor_nom, zona as zona_nom,
                   DATEDIFF(CURDATE(), fecha_reg) AS dias_transcurridos
            FROM tab_facturas 
            WHERE pagada = 'NO' 
            AND (anulado IS NULL OR anulado <> 'si')
            AND (total - abono_factura) > 0 
            AND DATEDIFF(CURDATE(), fecha_reg) >= ?
        `;
        
        const params = [minDias];
        if (vendedor) { sql += ` AND vendedor = ?`; params.push(vendedor); }
        if (zona) { sql += ` AND zona = ?`; params.push(zona); }
        sql += ` ORDER BY dias_transcurridos DESC`;

        const [rows] = await conn.execute(sql, params);
        return rows;
    } catch (e) { 
        console.error("Error en obtenerListaDeudores:", e);
        return []; 
    } finally { if (conn) await conn.end(); }
}

// --- GENERADOR DE MENSAJES PROFESIONALES ---

function prepararMensaje(tipo, row) {
    // Lista de clientes que no deben ver precios en bolívares (Personalización guardada)
    const clientesSinBS = ["CLIENTE_RESTRINGIDO_1"]; 
    const mostrarBS = !clientesSinBS.includes(row.nombres);

    const saldoUSD = parseFloat(row.saldo_usd).toFixed(2);
    // Cálculo: Saldo USD / Porcentaje
    const saldoBS = row.porcentaje > 0 ? (row.saldo_usd / row.porcentaje).toFixed(2) : "0.00";
    
    const nombreFull = `${row.nombres} ${row.apellidos || ''}`.trim();
    const firma = "\n\nSaludos Cordiales, *REPUESTOS CALAMON C.A.*";
    const despedida = "\nMuchas Gracias por su Atención.";

    switch (tipo) {
        case 'llegando_vencimiento':
            let msg1 = `${firma}\nLe Notificamos que la Nota *${row.nro_factura}* por un monto de *$${saldoUSD}*, que presenta *${row.dias_transcurridos} días* de su emisión está próximo a llegar al limite para poder disfrutar de su Descuento, la fecha limite para pagar la factura es *${new Date().toLocaleDateString()}* el descuento es del *30%* y el monto a pagar en divisas antes de esa fecha es *$${saldoUSD}*`;
            if (mostrarBS) msg1 += ` y en bolívares es *Bs. ${saldoBS}*`;
            msg1 += `.\n\n*Aproveche y no pierda su Descuento*, estimado(a) ${nombreFull}.`;
            return msg1;

        case 'perdida_descuento':
            let msg2 = `${firma}\nLe Notificamos que la Nota *${row.nro_factura}* por un monto de *$${saldoUSD}*`;
            if (mostrarBS) msg2 += ` (Bs. ${saldoBS})`;
            msg2 += `, esta llegando a su vencimiento a nombre de ${nombreFull}.${despedida}`;
            return msg2;

        case 'atraso_nota':
            let msg3 = `${firma}\nLe Notificamos que la Nota *${row.nro_factura}* por un monto de *$${saldoUSD}*`;
            if (mostrarBS) msg3 += ` / Bs. ${saldoBS}`;
            msg3 += `, presenta *${row.dias_transcurridos} días* de su emisión y debe ser cancelada, agradecido de antemano por colaboracion con el cliente ${nombreFull}, gracias por su Atenciòn.`;
            return msg3;

        default:
            return `Hola ${nombreFull}, tiene la factura ${row.nro_factura} pendiente por $${saldoUSD}.`;
    }
}

// --- ENVÍO MASIVO ---

async function ejecutarEnvioMasivo(sock, facturas, tipoMensaje = 'atraso_nota') {
    for (const row of facturas) {
        try {
            // Limpieza de número celular
            let num = row.celular.toString().replace(/\s/g, '').replace(/\D/g, '');
            if (num.startsWith('580')) num = '58' + num.substring(3);
            if (!num.startsWith('58')) num = '58' + num;

            const jid = `${num}@s.whatsapp.net`;
            const texto = prepararMensaje(tipoMensaje, row);
            
            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado (${tipoMensaje}) a: ${row.nombres} - ${num}`);
            
            // Pausa de 10 segundos para evitar spam
            await new Promise(r => setTimeout(r, 10000));
        } catch (e) {
            console.log(`❌ Error enviando factura ${row.nro_factura}:`, e.message);
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas };
