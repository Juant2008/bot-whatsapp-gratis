javascript. const mysql = require('mysql2/promise');



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

            SELECT celular, nombres, nro_factura, total, abono_factura,

                   (total - abono_factura) AS saldo_pendiente, ((total - abono_factura) / NULLIF(porcentaje, 0)) AS saldo_bolivares,

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



async function ejecutarEnvioMasivo(sock, facturas) {

    for (const row of facturas) {

        try {

            // 1. Limpiar espacios y caracteres no numéricos

            let num = row.celular.toString().replace(/\s/g, '').replace(/\D/g, '');

            

            // 2. Corregir formato: si empieza con 580412... -> 58412...

            if (num.startsWith('580')) {

                num = '58' + num.substring(3);

            }

            

            // 3. Asegurar prefijo internacional

            if (!num.startsWith('58')) num = '58' + num;



            const jid = `${num}@s.whatsapp.net`;

const texto = `Hola *${row.nombres}* 🚗, de *ONE4CARS*.\n\nLe Notificamos que su Nota está pendiente:\n\nFactura: *${row.nro_factura}*\nSaldo: *Bs. ${parseFloat(row.saldo_bolivares).toFixed(2)}*\nPresenta: *${row.dias_transcurridos} días vencidos*\n\nPor favor, gestione su pago a la brevedad. Cuide su crédito, es valioso.`;
            

            await sock.sendMessage(jid, { text: texto });

            console.log(`✅ Enviado a: ${num}`);

            

            // Espera de 10 segundos entre mensajes para evitar bloqueo

            await new Promise(r => setTimeout(r, 10000));

        } catch (e) {

            console.log("Error enviando a una fila");

        }

    }

}



module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas }; completo
