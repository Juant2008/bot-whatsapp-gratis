const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

// Obtiene la lista de vendedores activos
async function obtenerVendedores() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id_vendedor, nombre FROM tab_vendedores WHERE activo = "si" ORDER BY nombre ASC');
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

// Obtiene la lista de zonas
async function obtenerZonas() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id_zona, zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

// Consulta principal de deudores con cálculo de saldo y días
async function obtenerListaDeudores(filtros = {}) {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const minDias = filtros.dias || 30;
        const idVendedor = filtros.id_vendedor || '';
        const idZona = filtros.id_zona || '';

        let sql = `
            SELECT f.celular, f.nombres, f.nro_factura, f.total, f.abono_factura,
                   (f.total - f.abono_factura) AS saldo_pendiente,
                   f.fecha_reg, v.nombre as vendedor_nom, z.zona as zona_nom,
                   DATEDIFF(CURDATE(), f.fecha_reg) AS dias_transcurridos
            FROM tab_facturas f
            LEFT JOIN tab_vendedores v ON f.vendedor = v.nombre
            LEFT JOIN tab_zonas z ON f.zona = z.zona
            WHERE f.pagada = 'NO' AND f.id_cliente <> 334 AND f.anulado <> 'si'
            AND (f.total - f.abono_factura) > 0 
            AND DATEDIFF(CURDATE(), f.fecha_reg) >= ?
        `;
        const params = [minDias];
        if (idVendedor) { sql += ` AND v.id_vendedor = ?`; params.push(idVendedor); }
        if (idZona) { sql += ` AND z.id_zona = ?`; params.push(idZona); }
        sql += ` ORDER BY dias_transcurridos DESC`;

        const [rows] = await connection.execute(sql, params);
        return rows;
    } catch (error) { 
        console.error("Error DB:", error.message); 
        return []; 
    } finally { if (connection) await connection.end(); }
}

// Ejecuta el envío con pausa de seguridad
async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`🚀 Iniciando envío a ${deudores.length} clientes...`);
    for (const row of deudores) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);

            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe informamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nEsta factura tiene ${row.dias_transcurridos} días de vencimiento. Por favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado: ${row.nombres}`);
            await new Promise(resolve => setTimeout(resolve, 20000));
        } catch (e) { console.error(`❌ Error con ${row.nombres}:`, e.message); }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas };
