const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

// Función para llenar el menú desplegable de zonas
async function obtenerZonas() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT DISTINCT zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) {
        console.error("Error cargando zonas:", e.message);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

async function obtenerListaDeudores(filtroZona = '') {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        // Consulta con resta de abono y filtro de zona opcional
        let sql = `
            SELECT celular, nombres, nro_factura, total, abono_factura, 
            (total - abono_factura) AS saldo_pendiente, fecha_reg, zona,
            DATEDIFF(CURDATE(), fecha_reg) AS dias_transcurridos 
            FROM tab_facturas 
            WHERE pagada = 'NO' AND anulado <> 'si' AND id_cliente <> 334
            AND (total - abono_factura) > 0
        `;
        
        const params = [];
        if (filtroZona) {
            sql += ` AND zona = ?`;
            params.push(filtroZona);
        }
        
        sql += ` ORDER BY fecha_reg ASC`;

        const [rows] = await connection.execute(sql, params);
        return rows;
    } catch (error) {
        console.error("Error MySQL:", error.message);
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
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nPor favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a: ${row.nombres} | Saldo: ${saldo}`);
            await new Promise(r => setTimeout(r, 20000));
        } catch (e) {
            console.error(`Error enviando a ${row.nombres}`);
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerZonas };
