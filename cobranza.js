const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

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

async function obtenerListaDeudores(filtros = {}) {
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const minDias = filtros.dias || 0;
        const vendedor = filtros.vendedor || '';
        const zona = filtros.zona || '';

        let sql = `
            SELECT celular, nombres, apellidos, nro_factura, total, abono_factura, porcentaje,
                   (total - abono_factura) AS saldo_pendiente,
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
    } catch (e) { return []; } finally { if (conn) await conn.end(); }
}

async function ejecutarEnvioMasivo(sock, facturas, tipoMensaje = 'atraso_nota') {
    for (const row of facturas) {
        try {
            const saldoUSD = parseFloat(row.saldo_pendiente || 0);
            const tasa = parseFloat(row.porcentaje || 0);
            const saldoBS = tasa > 0 ? (saldoUSD / tasa) : 0;
            
            const montoUSDStr = `$${saldoUSD.toFixed(2)}`;
            const montoBSStr = `Bs. ${saldoBS.toFixed(2)}`;
            const nombreFull = `${row.nombres} ${row.apellidos || ''}`.trim();

            const clientesSinBS = []; 
            const mostrarBS = !clientesSinBS.includes(row.nombres);

            let texto = "";
            const saludo = `Saludos Cordiales, ${nombreFull}.`;

            if (tipoMensaje === 'llegando_vencimiento') {
                texto = `${saludo} Le Notificamos que la Nota *${row.nro_factura}* por un monto de *${montoUSDStr}*, que presenta *${row.dias_transcurridos} dias* de su emision esta próximo a llegar al limite para poder disfrutar de su Descuento, la fecha limite para pagar la factura es *23-01-2026* el descuento es del *30%* y el monto a pagar en divisas antes de esa fecha es *${montoUSDStr}*`;
                if (mostrarBS && tasa > 0) texto += ` y en bolívares es *${montoBSStr}*`;
                texto += `, *Aproveche y no pierda su Descuento*.`;
            
            } else if (tipoMensaje === 'perdida_descuento') {
                texto = `${saludo} Le Notificamos que la Nota *${row.nro_factura}* por un monto de *${montoUSDStr}*`;
                if (mostrarBS && tasa > 0) texto += ` (${montoBSStr})`;
                texto += `, esta llegando a su vencimiento Muchas Gracias por su Atenciòn.`;
            
            } else { // atraso_nota
                texto = `${saludo} Le Notificamos que la Nota *${row.nro_factura}* por un monto de *${montoUSDStr}*`;
                if (mostrarBS && tasa > 0) texto += ` / ${montoBSStr}`;
                texto += `, presenta *${row.dias_transcurridos} dias* de su emision y debe ser cancelada, agradecido de antemano por colaboracion, gracias por su Atenciòn.`;
            }

            let num = row.celular.toString().replace(/\s/g, '').replace(/\D/g, '');
            if (num.startsWith('580')) num = '58' + num.substring(3);
            if (!num.startsWith('58')) num = '58' + num;

            const jid = `${num}@s.whatsapp.net`;
            
            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado (${tipoMensaje}) a: ${nombreFull}`);
            
            await new Promise(r => setTimeout(r, 10000));
        } catch (e) {
            console.log("Error enviando a una fila:", e.message);
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas };
