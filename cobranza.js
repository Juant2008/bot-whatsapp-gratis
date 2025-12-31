const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

// Ahora recibe un objeto de filtros
async function obtenerListaDeudores(filtros = {}) {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        // Valores por defecto
        const minDias = filtros.dias || 300;
        const vendedor = filtros.vendedor || '';
        const zona = filtros.zona || '';

        let sql = `
            SELECT celular, nombres, nro_factura, total, fecha_reg, vendedor, zona,
            DATEDIFF(CURDATE(), fecha_reg) AS dias_transcurridos
            FROM tab_facturas 
            WHERE pagada = 'NO' 
            AND id_cliente <> 334 
            AND anulado <> 'si'
            AND DATEDIFF(CURDATE(), fecha_reg) >= ?
        `;

        const params = [minDias];

        if (vendedor) {
            sql += ` AND vendedor LIKE ?`;
            params.push(`%${vendedor}%`);
        }
        if (zona) {
            sql += ` AND zona LIKE ?`;
            params.push(`%${zona}%`);
        }

        sql += ` ORDER BY dias_transcurridos DESC`;

        const [rows] = await connection.execute(sql, params);
        return rows;
    } catch (error) {
        console.error("❌ ERROR MYSQL:", error.message);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

async function ejecutarEnvioMasivo(sock, deudoresSeleccionados) {
    console.log(`\n--- 🚀 ENVIANDO ${deudoresSeleccionados.length} MENSAJES ---`);
    for (const row of deudoresSeleccionados) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;
            
            // Formateamos la fecha para que no salga el GMT largo
            const fechaCorta = new Date(row.fecha_reg).toISOString().split('T')[0];

            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* por un monto de *${row.total}* tiene *${row.dias_transcurridos} días* vencida (Emitida el ${fechaCorta}).\n\nPor favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado: ${row.nombres} (${row.dias_transcurridos} días)`);

            await new Promise(resolve => setTimeout(resolve, 15000));
        } catch (e) {
            console.error(`❌ Error enviando a ${row.nombres}:`, e.message);
        }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo };
