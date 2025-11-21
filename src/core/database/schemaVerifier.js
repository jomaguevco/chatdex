const kardexDb = require('../../kardexDb');
const logger = require('../../utils/logger');

/**
 * Verificador y creador de esquema de base de datos
 * 
 * Este módulo verifica que existan todas las tablas necesarias para el funcionamiento
 * del bot de ventas y las crea si no existen.
 * 
 * Tablas verificadas:
 * - productos: Catálogo de productos
 * - categorias: Categorías de productos
 * - clientes: Información de clientes
 * - pedidos: Órdenes de pedidos
 * - detalle_pedidos: Detalle de productos en pedidos
 * - ventas: Ventas realizadas
 * - detalle_ventas: Detalle de productos en ventas
 * - promociones: Promociones y descuentos activos
 * - stock_movimientos: Historial de movimientos de stock (opcional)
 * 
 * @module core/database/schemaVerifier
 */

class SchemaVerifier {
  constructor() {
    this.verified = false;
    this.tablesInfo = {};
  }

  /**
   * Verificar y crear todas las tablas necesarias
   * 
   * @returns {Promise<boolean>} true si todas las tablas están disponibles, false si hay errores
   */
  async verifyAndCreateTables() {
    if (!kardexDb.isConnected()) {
      logger.warn('⚠️ Base de datos no conectada, no se puede verificar esquema');
      return false;
    }

    try {
      logger.info('🔍 Verificando esquema de base de datos...');
      
      const tablesToVerify = [
        'productos',
        'categorias',
        'clientes',
        'pedidos',
        'detalle_pedidos',
        'ventas',
        'detalle_ventas',
        'promociones'
      ];

      const results = {};
      let allExist = true;

      for (const tableName of tablesToVerify) {
        const exists = await this.tableExists(tableName);
        results[tableName] = exists;
        
        if (!exists) {
          logger.warn(`⚠️ Tabla '${tableName}' no existe`);
          allExist = false;
        } else {
          logger.info(`✅ Tabla '${tableName}' existe`);
          // Obtener información de la tabla
          const tableInfo = await this.getTableInfo(tableName);
          this.tablesInfo[tableName] = tableInfo;
        }
      }

      // Si faltan tablas, intentar crearlas solo si son críticas
      if (!allExist) {
        logger.warn('⚠️ Algunas tablas no existen. El bot funcionará con las tablas disponibles.');
        logger.warn('⚠️ Si necesitas las tablas faltantes, créalas manualmente en la base de datos.');
      }

      this.verified = true;
      logger.success('✅ Verificación de esquema completada');
      
      return allExist;
    } catch (error) {
      logger.error('❌ Error al verificar esquema de base de datos:', error);
      return false;
    }
  }

  /**
   * Verificar si una tabla existe
   * 
   * @param {string} tableName - Nombre de la tabla a verificar
   * @returns {Promise<boolean>} true si la tabla existe, false si no
   */
  async tableExists(tableName) {
    if (!kardexDb.isConnected()) {
      return false;
    }

    try {
      const [rows] = await kardexDb.pool.execute(
        `SELECT COUNT(*) as count 
         FROM information_schema.tables 
         WHERE table_schema = DATABASE() 
         AND table_name = ?`,
        [tableName]
      );

      return rows[0].count > 0;
    } catch (error) {
      logger.error(`Error al verificar existencia de tabla '${tableName}':`, error);
      return false;
    }
  }

  /**
   * Obtener información de una tabla (columnas)
   * 
   * @param {string} tableName - Nombre de la tabla
   * @returns {Promise<object>} Información de la tabla con sus columnas
   */
  async getTableInfo(tableName) {
    if (!kardexDb.isConnected()) {
      return null;
    }

    try {
      const [columns] = await kardexDb.pool.execute(
        `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY
         FROM information_schema.COLUMNS 
         WHERE TABLE_SCHEMA = DATABASE() 
         AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [tableName]
      );

      return {
        name: tableName,
        columns: columns,
        columnCount: columns.length
      };
    } catch (error) {
      logger.error(`Error al obtener información de tabla '${tableName}':`, error);
      return null;
    }
  }

  /**
   * Verificar estructura de una tabla específica
   * 
   * @param {string} tableName - Nombre de la tabla
   * @param {array} requiredColumns - Array de objetos {name, type, nullable} con columnas requeridas
   * @returns {Promise<object>} {exists: boolean, missing: array, valid: boolean}
   */
  async verifyTableStructure(tableName, requiredColumns = []) {
    const exists = await this.tableExists(tableName);
    
    if (!exists) {
      return { exists: false, missing: requiredColumns.map(c => c.name), valid: false };
    }

    const tableInfo = await this.getTableInfo(tableName);
    if (!tableInfo) {
      return { exists: true, missing: requiredColumns.map(c => c.name), valid: false };
    }

    const existingColumns = tableInfo.columns.map(c => c.COLUMN_NAME.toLowerCase());
    const missing = requiredColumns.filter(c => 
      !existingColumns.includes(c.name.toLowerCase())
    );

    return {
      exists: true,
      missing: missing.map(c => c.name),
      valid: missing.length === 0,
      columns: tableInfo.columns
    };
  }

  /**
   * Obtener estructura esperada de tablas críticas
   * 
   * @returns {object} Estructura esperada de columnas por tabla
   */
  getExpectedStructure() {
    return {
      productos: [
        { name: 'id', type: 'INT', nullable: false },
        { name: 'nombre', type: 'VARCHAR', nullable: false },
        { name: 'codigo_interno', type: 'VARCHAR', nullable: true },
        { name: 'descripcion', type: 'TEXT', nullable: true },
        { name: 'precio_venta', type: 'DECIMAL', nullable: false },
        { name: 'stock_actual', type: 'INT', nullable: false },
        { name: 'activo', type: 'TINYINT', nullable: false },
        { name: 'categoria_id', type: 'INT', nullable: true }
      ],
      categorias: [
        { name: 'id', type: 'INT', nullable: false },
        { name: 'nombre', type: 'VARCHAR', nullable: false },
        { name: 'descripcion', type: 'TEXT', nullable: true },
        { name: 'activo', type: 'TINYINT', nullable: false }
      ],
      clientes: [
        { name: 'id', type: 'INT', nullable: false },
        { name: 'nombre', type: 'VARCHAR', nullable: false },
        { name: 'telefono', type: 'VARCHAR', nullable: true },
        { name: 'email', type: 'VARCHAR', nullable: true },
        { name: 'direccion', type: 'TEXT', nullable: true },
        { name: 'tipo_documento', type: 'VARCHAR', nullable: true },
        { name: 'numero_documento', type: 'VARCHAR', nullable: true }
      ],
      pedidos: [
        { name: 'id', type: 'INT', nullable: false },
        { name: 'cliente_id', type: 'INT', nullable: false },
        { name: 'numero_pedido', type: 'VARCHAR', nullable: false },
        { name: 'total', type: 'DECIMAL', nullable: false },
        { name: 'estado', type: 'VARCHAR', nullable: false },
        { name: 'fecha_pedido', type: 'DATETIME', nullable: false }
      ],
      detalle_pedidos: [
        { name: 'id', type: 'INT', nullable: false },
        { name: 'pedido_id', type: 'INT', nullable: false },
        { name: 'producto_id', type: 'INT', nullable: false },
        { name: 'cantidad', type: 'INT', nullable: false },
        { name: 'precio_unitario', type: 'DECIMAL', nullable: false },
        { name: 'subtotal', type: 'DECIMAL', nullable: false }
      ],
      ventas: [
        { name: 'id', type: 'INT', nullable: false },
        { name: 'cliente_id', type: 'INT', nullable: false },
        { name: 'numero_venta', type: 'VARCHAR', nullable: false },
        { name: 'total', type: 'DECIMAL', nullable: false },
        { name: 'fecha_venta', type: 'DATETIME', nullable: false }
      ],
      detalle_ventas: [
        { name: 'id', type: 'INT', nullable: false },
        { name: 'venta_id', type: 'INT', nullable: false },
        { name: 'producto_id', type: 'INT', nullable: false },
        { name: 'cantidad', type: 'INT', nullable: false },
        { name: 'precio_unitario', type: 'DECIMAL', nullable: false },
        { name: 'subtotal', type: 'DECIMAL', nullable: false }
      ],
      promociones: [
        { name: 'id', type: 'INT', nullable: false },
        { name: 'nombre', type: 'VARCHAR', nullable: false },
        { name: 'descripcion', type: 'TEXT', nullable: true },
        { name: 'descuento_porcentaje', type: 'DECIMAL', nullable: true },
        { name: 'descuento_fijo', type: 'DECIMAL', nullable: true },
        { name: 'fecha_inicio', type: 'DATETIME', nullable: false },
        { name: 'fecha_fin', type: 'DATETIME', nullable: false },
        { name: 'activo', type: 'TINYINT', nullable: false }
      ]
    };
  }

  /**
   * Validar estructura completa de todas las tablas
   * 
   * @returns {Promise<object>} Reporte de validación
   */
  async validateAllTables() {
    if (!kardexDb.isConnected()) {
      return {
        valid: false,
        error: 'Base de datos no conectada',
        tables: {}
      };
    }

    const expected = this.getExpectedStructure();
    const validation = {
      valid: true,
      tables: {}
    };

    for (const [tableName, columns] of Object.entries(expected)) {
      const result = await this.verifyTableStructure(tableName, columns);
      validation.tables[tableName] = result;
      
      if (!result.valid) {
        validation.valid = false;
      }
    }

    return validation;
  }

  /**
   * Obtener reporte del estado del esquema
   * 
   * @returns {Promise<object>} Reporte completo del esquema
   */
  async getSchemaReport() {
    if (!kardexDb.isConnected()) {
      return {
        connected: false,
        message: 'Base de datos no conectada'
      };
    }

    await this.verifyAndCreateTables();
    const validation = await this.validateAllTables();

    return {
      connected: true,
      verified: this.verified,
      validation,
      tablesInfo: this.tablesInfo
    };
  }
}

module.exports = new SchemaVerifier();
