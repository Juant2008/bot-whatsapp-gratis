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
        const [rows] = await conn.execute('SELECT DISTINCT zona FROM tab_cliente WHERE zona IS NOT NULL AND zona != "" ORDER BY zona ASC');
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

        // Usamos valor_cambio de tab_monedas para el cálculo de bolívares
        let sql = `
            SELECT celular, nombres, nro_factura, total, abono_factura,
                   (total - abono_factura) AS saldo_pendiente, 
                   ((total - abono_factura) * (SELECT valor_cambio FROM tab_monedas WHERE id_moneda = 2 LIMIT 1)) AS saldo_bolivares,
                   DATEDIFF(CURDATE(), fecha_vencimiento) as dias_transcurridos 
            FROM tab_facturas 
            WHERE pagada = 'NO' 
            AND (total - abono_factura) > 1 
            AND DATEDIFF(CURDATE(), fecha_vencimiento) >= ?`;
        
        let params = [minDias];
        if (vendedor) { 
            sql += ` AND id_vendedor = (SELECT id_vendedor FROM tab_vendedores WHERE nombre = ? LIMIT 1)`; 
            params.push(vendedor); 
        }
        if (zona) { 
            sql += ` AND id_cliente IN (SELECT id_cliente FROM tab_cliente WHERE zona = ?)`; 
            params.push(zona); 
        }
        
        const [rows] = await conn.execute(sql, params);
        return rows;
    } catch (e) { 
        console.error("Error SQL:", e.message); 
        return []; 
    } finally { if (conn) await conn.end(); }
}

async function ejecutarEnvioMasivo(sock, facturas) {
    const excluirBolivares = ['CLIENTE_1', 'CLIENTE_2']; 
    for (const row of facturas) {
        try {
            let num = row.celular.toString().replace(/\D/g, '');
            if (!num.startsWith('58')) num = '58' + num;
            const jid = `${num}@s.whatsapp.net`;

            let saldoTexto = excluirBolivares.includes(row.nombres) 
                ? `Saldo: *Ref. ${parseFloat(row.saldo_pendiente).toFixed(2)}*`
                : `Saldo: *Bs. ${parseFloat(row.saldo_bolivares).toFixed(2)}* (Ref. ${parseFloat(row.saldo_pendiente).toFixed(2)})`;

            const texto = `Hola *${row.nombres}* 🚗, de *ONE4CARS*.\n\nLe Notificamos que su Nota está pendiente:\n\nFactura: *${row.nro_factura}*\n${saldoTexto}\nPresenta: *${row.dias_transcurridos} días vencidos*\n\nPor favor, gestione su pago a la brevedad. Su crédito con nosotros es fundamental para seguir creciendo juntos.`;
            
            if (sock && sock.sendMessage) {
                await sock.sendMessage(jid, { text: texto });
                console.log(`✅ Enviado a: ${num}`);
            }
            await new Promise(r => setTimeout(r, 10000));
        } catch (e) { console.log("Error envío fila"); }
    }
}

module.exports = { obtenerVendedores, obtenerZonas, obtenerListaDeudores, ejecutarEnvioMasivo };
