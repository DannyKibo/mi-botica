-- Datos iniciales migrados desde el sistema PHP original (botica_db_completo.sql)
-- Usuario admin por defecto: admin / admin123  (debe cambiar contraseña en el primer ingreso)

INSERT INTO roles (id, nombre, descripcion) VALUES
 (1, 'Administrador', 'Acceso total al sistema'),
 (2, 'Químico Farmacéutico', 'Acceso total, excepto preparar el sistema para entrega a un cliente nuevo'),
 (3, 'Propietario', 'Acceso total, excepto preparar el sistema para entrega a un cliente nuevo'),
 (4, 'Técnico en Farmacia', 'Solo ventas, compras (ingreso de mercadería) y creación de productos nuevos');

INSERT INTO usuarios (id, nombres, apellidos, usuario, password, debe_cambiar_password, email, rol_id, estado, creado_en) VALUES
 (1, 'Admin', 'Sistema', 'admin', '$2b$12$UnsY0LZ2MyIHttWJMHwblu5sjX2yrDuhemvBLBq6XgiUlWrkUwttq', 1, 'admin@botica.com', 1, 1, CURRENT_TIMESTAMP);

INSERT INTO categorias (id, nombre, descripcion, estado) VALUES
 (1, 'Analgésicos y Antipiréticos', NULL, 1),
 (2, 'Antibióticos', NULL, 1),
 (3, 'Antialérgicos', NULL, 1),
 (4, 'Vitaminas', NULL, 1),
 (5, 'Cuidado Personal', NULL, 1);

INSERT INTO laboratorios (id, nombre, descripcion, estado) VALUES
 (1, 'Bayer S.A.', NULL, 1),
 (2, 'Pfizer', NULL, 1),
 (3, 'Genfar', NULL, 1),
 (4, 'Farmindustria', NULL, 1),
 (5, 'Teva Perú', NULL, 1);

INSERT INTO proveedores (id, ruc, razon_social, representante, telefono, direccion, estado) VALUES
 (1, '20546781234', 'Droguería Del Sur S.A.C.', NULL, '987654321', 'Av. Sur 123, Lima', 1),
 (2, '20123456789', 'Distribuidora Continental S.A.', NULL, '912345678', 'Industrial 45, Lima', 1),
 (3, '20456123789', 'Medifarma Distribuidores', NULL, '998877665', 'Km 23 Panamericana', 1),
 (4, '20100200301', 'Distribuidora FarmaOriente S.A.C.', 'Ing. Ricardo Arana', '044-203040', 'Lima, Santa Anita', 1),
 (5, '20506070802', 'Global Medicine Perú', 'Lic. Carmen Rosa', '01-4556677', 'Av. Iquitos 455, La Victoria', 1);

INSERT INTO productos (id, codigo_barras, nombre_generico, nombre_comercial, concentracion, forma_farmaceutica, id_laboratorio, id_categoria, precio_compra, precio_venta, margen_ganancia, unidad_medida, requiere_receta, stock_actual, stock_minimo, estado, fraccionable, unidades_por_caja, unidad_fraccion, precio_fraccion) VALUES
 (1, '77512345001', 'Paracetamol', 'Panadol Fuerte', '500mg', 'Tableta', 1, 1, 15.00, 25.00, 40.00, 'Caja', 0, 480, 50, 1, 1, 100, 'Pastilla', 0.50),
 (2, '77512345002', 'Amoxicilina', 'Amoxil', '500mg', 'Cápsula', 2, 2, 20.00, 35.00, 42.00, 'Caja', 1, 120, 20, 1, 1, 50, 'Cápsula', 1.00),
 (3, '77512345003', 'Cetirizina', 'Alercet', '10mg', 'Tableta', 3, 3, 10.00, 18.00, 44.00, 'Caja', 0, 150, 50, 1, 1, 100, 'Pastilla', 0.30),
 (4, '77512345004', 'Multivitamínico', 'Supradyn', '1g', 'Tableta Ef', 1, 4, 12.00, 20.00, 40.00, 'Tubo', 0, 45, 10, 1, 0, 1, 'Unidad', 0.00),
 (5, '77512345005', 'Crema Dental', 'Colgate Total 12', '150g', 'Crema', 4, 5, 8.00, 12.00, 33.00, 'Unidad', 0, 60, 15, 1, 0, 1, 'Unidad', 0.00),
 (6, '77512345006', 'Ibuprofeno', 'Ibuprofeno Genfar', '400mg', 'Tableta', 3, 1, 5.00, 10.00, 50.00, 'Caja', 0, 310, 50, 1, 1, 100, 'Pastilla', 0.20),
 (7, '77512345007', 'Losartán', 'Losartán Potásico', '50mg', 'Tableta', 4, 1, 18.00, 28.00, 35.00, 'Caja', 1, 180, 50, 1, 1, 50, 'Pastilla', 0.80);

INSERT INTO clientes (id, tipo_documento, num_documento, nombres, telefono, direccion, puntos_acumulados, estado) VALUES
 (1, 'Sin Documento', '00000000', 'Cliente Público en General', '', NULL, 0, 1),
 (2, 'DNI', '71234567', 'Juan Perez Lopez', '987123456', 'Av Las Palmeras', 0, 1),
 (3, 'DNI', '42567812', 'Maria Gomez Silva', '912345678', 'Los Pinos 102', 0, 1);

INSERT INTO configuracion (clave, valor, descripcion) VALUES
 ('nombre_botica', 'Mi Botica', 'Nombre comercial de la farmacia/botica'),
 ('ruc', '20123456789', 'RUC de la empresa'),
 ('direccion', 'Av. Principal 123', 'Dirección del establecimiento'),
 ('telefono', '999888777', 'Teléfono principal'),
 ('moneda', 'S/', 'Símbolo de moneda'),
 ('igv', '18', 'Porcentaje de IGV'),
 ('logo', '', 'Ruta del logo institucional'),
 ('puntos_habilitado', '0', 'Si el sistema de puntos de fidelización está activo'),
 ('puntos_por_sol', '1.00', 'Puntos ganados por cada S/ 1.00 de venta');

-- Lotes de ejemplo para los productos cargados arriba (para probar alertas de vencimiento)
INSERT INTO inventario_lotes (id_producto, codigo_lote, fecha_vencimiento, cantidad_inicial, cantidad_disponible, estado) VALUES
 (1, 'L-PAN-2027', '2027-12-31', 500, 480, 1),
 (2, 'L-AMX-2028', '2028-05-15', 150, 120, 1),
 (3, 'L-ALR-RED', '2026-09-21', 300, 150, 1),
 (6, 'L-IBU-YELLOW', '2026-09-24', 400, 310, 1);
