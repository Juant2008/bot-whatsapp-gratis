const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

async function obtenerZonas() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT DISTINCT zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

async function obtenerListaDeudores(zonaFiltro = '') {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        let sql = `
            SELECT celular, nombres, nro_factura, total, abono_factura, 
            (total - abono_factura) AS saldo_pendiente, fecha_reg, zona,
            DATEDIFF(CURDATE(), fecha_reg) AS dias_mora
            FROM tab_facturas 
            WHERE pagada = 'NO' AND anulado <> 'si' AND id_cliente <> 334
            AND (total - abono_factura) > 0
            AND DATEDIFF(CURDATE(), fecha_reg) > 300
        `;
        const params = [];
        if (zonaFiltro) { sql += ` AND zona = ?`; params.push(zonaFiltro); }
        sql += ` ORDER BY fecha_reg ASC`;
        const [rows] = await connection.execute(sql, params);
        return rows;
    } catch (error) { return []; } finally { if (connection) await connection.end(); }
}

// NUEVA FUNCIÓN: Busca en la DB solo las facturas seleccionadas
async function obtenerFacturasPorId(listaFacturas) {
    if (!listaFacturas || listaFacturas.length === 0) return [];
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const placeholders = listaFacturas.map(() => '?').join(',');
        const [rows] = await connection.query(
            `SELECT celular, nombres, nro_factura, (total - abono_factura) AS saldo_pendiente, DATEDIFF(CURDATE(), fecha_reg) AS dias_mora 
             FROM tab_facturas WHERE nro_factura IN (${placeholders})`,
            listaFacturas
        );
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    for (const row of deudores) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);
            
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* tiene un *SALDO PENDIENTE de $${saldo}*.\n\nEsta deuda tiene ${row.dias_mora} días de vencimiento. Por favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a: ${row.nombres}`);
            await new Promise(r => setTimeout(r, 15000));
        } catch (e) { console.error(`❌ Error en ${row.nombres}`); }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerZonas, obtenerFacturasPorId };
