const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

async function obtenerVendedores() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id_vendedor, nombre FROM tab_vendedores WHERE activo = "si" ORDER BY nombre ASC');
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

async function obtenerZonas() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT id_zona, zona FROM tab_zonas ORDER BY zona ASC');
        return rows;
    } catch (e) { return []; } finally { if (connection) await connection.end(); }
}

async function obtenerListaDeudores(filtros = {}) {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        
        const minDias = filtros.dias || 30; // Si no pones días, busca desde 30
        const idVendedor = filtros.id_vendedor || '';
        const idZona = filtros.id_zona || '';

        let sql = `
            SELECT f.celular, f.nombres, f.nro_factura, f.total, f.fecha_reg, 
                   v.nombre as vendedor_nom, z.zona as zona_nom,
                   DATEDIFF(CURDATE(), f.fecha_reg) AS dias_transcurridos
            FROM tab_facturas f
            LEFT JOIN tab_vendedores v ON f.id_vendedor = v.id_vendedor
            LEFT JOIN tab_zonas z ON f.id_zona = z.id_zona
            WHERE f.pagada = 'NO' 
            AND f.id_cliente <> 334 
            AND f.anulado <> 'si'
            AND DATEDIFF(CURDATE(), f.fecha_reg) >= ?
        `;

        const params = [minDias];

        if (idVendedor) {
            sql += ` AND f.id_vendedor = ?`;
            params.push(idVendedor);
        }
        if (idZona) {
            sql += ` AND f.id_zona = ?`;
            params.push(idZona);
        }

        sql += ` ORDER BY dias_transcurridos DESC`;

        const [rows] = await connection.execute(sql, params);
        console.log(`📊 Consulta ejecutada. Filtro días: ${minDias}. Encontrados: ${rows.length}`);
        return rows;
    } catch (error) {
        console.error("❌ ERROR EN CONSULTA COBRANZA:", error.message);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

async function ejecutarEnvioMasivo(sock, deudoresSeleccionados) {
    for (const row of deudoresSeleccionados) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;
            
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un saldo pendiente de *${row.total}* con ${row.dias_transcurridos} días de vencimiento.\n\nPor favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            await new Promise(resolve => setTimeout(resolve, 20000));
        } catch (e) { console.error("Error envío:", e.message); }
    }
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas };
