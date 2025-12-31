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
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const minDias = filtros.dias || 30;
        const vendedor = filtros.vendedor || '';
        const zona = filtros.zona || '';

        let sql = `
            SELECT f.celular, f.nombres, f.nro_factura, f.total, f.abono_factura,
                   (f.total - f.abono_factura) AS saldo_pendiente, f.fecha_reg,
                   DATEDIFF(CURDATE(), f.fecha_reg) AS dias_mora
            FROM tab_facturas f
            WHERE f.pagada = 'NO' AND f.anulado <> 'si' AND f.id_cliente <> 334
            AND (f.total - f.abono_factura) > 0 
            AND DATEDIFF(CURDATE(), f.fecha_reg) >= ?
        `;
        const params = [minDias];
        if (vendedor) { sql += ` AND f.vendedor = ?`; params.push(vendedor); }
        if (zona) { sql += ` AND f.zona = ?`; params.push(zona); }
        sql += ` ORDER BY dias_mora DESC`;

        const [rows] = await connection.execute(sql, params);
        return rows;
    } catch (error) { return []; } finally { if (connection) await connection.end(); }
}

async function obtenerDetalleFacturas(ids) {
    if (!ids || ids.length === 0) return [];
    let conn;
    try {
        conn = await mysql.createConnection(dbConfig);
        const formatIds = Array.isArray(ids) ? ids : [ids];
        const placeholders = formatIds.map(() => '?').join(',');
        const [rows] = await conn.query(
            `SELECT celular, nombres, nro_factura, (total - abono_factura) as saldo_pendiente, DATEDIFF(CURDATE(), fecha_reg) as dias_mora 
             FROM tab_facturas WHERE nro_factura IN (${placeholders})`,
            formatIds
        );
        return rows;
    } catch (e) { return []; } finally { if (conn) await conn.end(); }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    if (!sock || !sock.user) return console.log("Bot no listo");
    
    for (const row of deudores) {
        try {
            // LIMPIEZA QUIRÚRGICA DEL NÚMERO (Elimina espacios y corrige 580)
            let num = row.celular.toString().replace(/\D/g, ''); 
            if (num.startsWith('580')) num = '58' + num.substring(3);
            else if (!num.startsWith('58')) num = '58' + num;
            
            const jid = `${num}@s.whatsapp.net`;
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);
            const texto = `Hola *${row.nombres}* 🚗, de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nPor favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a ${row.nombres} (${num})`);
            await new Promise(r => setTimeout(r, 15000));
        } catch (e) { console.log("Error envío unitario"); }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas, obtenerDetalleFacturas };
