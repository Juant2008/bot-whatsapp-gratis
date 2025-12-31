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
        const minDias = filtros.dias || 30;
        const vendedor = filtros.vendedor || '';
        const zona = filtros.zona || '';

        let sql = `
            SELECT celular, nombres, nro_factura, total, abono_factura,
                   (total - abono_factura) AS saldo_pendiente,
                   fecha_reg, vendedor as vendedor_nom, zona as zona_nom,
                   DATEDIFF(CURDATE(), fecha_reg) AS dias_transcurridos
            FROM tab_facturas 
            WHERE pagada = 'NO' AND id_cliente <> 334 AND anulado <> 'si'
            AND (total - abono_factura) > 0 
            AND DATEDIFF(CURDATE(), fecha_reg) >= ?
        `;
        const params = [minDias];
        if (vendedor) { sql += ` AND vendedor = ?`; params.push(vendedor); }
        if (zona) { sql += ` AND zona = ?`; params.push(zona); }
        sql += ` ORDER BY dias_transcurridos DESC`;

        const [rows] = await conn.execute(sql, params);
        return rows;
    } catch (e) { console.error(e); return []; } finally { if (conn) await conn.end(); }
}

async function obtenerDetalleFacturas(ids) {
    if (!ids || ids.length === 0) return [];
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const formatIds = Array.isArray(ids) ? ids : [ids];
        const placeholders = formatIds.map(() => '?').join(',');
        const [rows] = await conn.query(
            `SELECT celular, nombres, nro_factura, (total - abono_factura) as saldo_pendiente, DATEDIFF(CURDATE(), fecha_reg) as dias_transcurridos 
             FROM tab_facturas WHERE nro_factura IN (${placeholders})`,
            formatIds
        );
        return rows;
    } catch (e) { return []; } finally { if (conn) await conn.end(); }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`🚀 Iniciando envío a ${deudores.length} clientes`);
    for (const row of deudores) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;
            const texto = `Hola *${row.nombres}* 🚗, de *ONE4CARS*.\n\nFactura: *${row.nro_factura}*\nSaldo Pendiente: *$${parseFloat(row.saldo_pendiente).toFixed(2)}*\nDías vencidos: *${row.dias_transcurridos}*.\n\nPor favor, gestione su pago a la brevedad.`;
            
            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a ${row.nombres}`);
            await new Promise(r => setTimeout(r, 15000));
        } catch (e) { console.log("Error en envío unitario"); }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas, obtenerDetalleFacturas };
