const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

// Traer las zonas reales de tu tabla tab_zonas
async function obtenerZonas() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT DISTINCT zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) {
        console.error("Error MySQL Zonas:", e.message);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

async function obtenerListaDeudores(zonaFiltro = '') {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        // Consulta base: resta abono al total y filtra por 300 días
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
        if (zonaFiltro && zonaFiltro !== '') {
            sql += ` AND zona = ?`;
            params.push(zonaFiltro);
        }
        
        sql += ` ORDER BY fecha_reg ASC`;

        const [rows] = await connection.execute(sql, params);
        return rows;
    } catch (error) {
        console.error("Error MySQL Deudores:", error.message);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    for (const row of deudores) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;
            
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nEsta deuda tiene ${row.dias_mora} días de vencimiento. Por favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado: ${row.nombres}`);
            await new Promise(r => setTimeout(r, 20000));
        } catch (e) {
            console.error(`❌ Error enviando a ${row.nombres}`);
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerZonas };
