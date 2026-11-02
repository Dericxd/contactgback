-- =========================================================================
-- Migración: menú dinámico por módulos + permisos directos por usuario
-- Fecha: 2026-10-30  |  MariaDB 10.4+
-- NO destructiva e idempotente: puede ejecutarse varias veces.
-- Respaldo previo: migrations/backup_2026_10_30_before_permissions.sql
-- =========================================================================
SET NAMES utf8mb4;
USE `newcontacts`;

START TRANSACTION;

-- -------------------------------------------------------------------------
-- 1. Estructura
-- -------------------------------------------------------------------------

-- modules: orden y visibilidad en el menú
ALTER TABLE `modules`
    ADD COLUMN IF NOT EXISTS `sort_order` INT NOT NULL DEFAULT 0 AFTER `route`,
    ADD COLUMN IF NOT EXISTS `show_in_menu` TINYINT(1) NOT NULL DEFAULT 1 AFTER `sort_order`;

-- permissions: cada permiso con `route` es una entrada del menú dentro de su módulo
ALTER TABLE `permissions`
    ADD COLUMN IF NOT EXISTS `route` VARCHAR(255) NULL DEFAULT NULL AFTER `description`,
    ADD COLUMN IF NOT EXISTS `menu_label` VARCHAR(100) NULL DEFAULT NULL AFTER `route`,
    ADD COLUMN IF NOT EXISTS `sort_order` INT NOT NULL DEFAULT 0 AFTER `menu_label`,
    ADD COLUMN IF NOT EXISTS `admin_only` TINYINT(1) NOT NULL DEFAULT 0
        COMMENT 'Solo el rol admin; no puede concederse por user_permissions' AFTER `sort_order`;

-- user_permissions: conceder / revocar + auditoría de quién lo otorgó
ALTER TABLE `user_permissions`
    ADD COLUMN IF NOT EXISTS `effect` ENUM('grant','revoke') NOT NULL DEFAULT 'grant' AFTER `permission_id`,
    ADD COLUMN IF NOT EXISTS `granted_by` INT(11) NULL DEFAULT NULL AFTER `effect`,
    ADD KEY IF NOT EXISTS `idx_user_permissions_granted_by` (`granted_by`);

ALTER TABLE `user_permissions`
    ADD CONSTRAINT `fk_user_permissions_granted_by` FOREIGN KEY IF NOT EXISTS (`granted_by`)
        REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- -------------------------------------------------------------------------
-- 2. Módulos: icono (clave de lista blanca en el frontend), orden y menú
-- -------------------------------------------------------------------------
UPDATE `modules` SET `icon` = 'users',     `sort_order` = 1, `show_in_menu` = 1 WHERE `slug` = 'agenda';
UPDATE `modules` SET `icon` = 'user-plus', `sort_order` = 2, `show_in_menu` = 1 WHERE `slug` = 'employees';
UPDATE `modules` SET `icon` = 'building',  `sort_order` = 3, `show_in_menu` = 1 WHERE `slug` = 'departments';
UPDATE `modules` SET `icon` = 'phone',     `sort_order` = 4, `show_in_menu` = 1 WHERE `slug` = 'phone-lines';
UPDATE `modules` SET `icon` = NULL,        `sort_order` = 5, `show_in_menu` = 0 WHERE `slug` = 'assignments';
UPDATE `modules` SET `icon` = 'shield',    `sort_order` = 9, `show_in_menu` = 1 WHERE `slug` = 'users';
UPDATE `modules` SET `icon` = NULL,        `sort_order` = 6, `show_in_menu` = 0 WHERE `slug` = 'reports';

-- -------------------------------------------------------------------------
-- 3. Permisos nuevos
-- -------------------------------------------------------------------------
INSERT INTO `permissions` (`module_id`, `name`, `slug`, `description`, `admin_only`)
SELECT m.id, x.name, x.slug, x.description, x.admin_only
FROM (
    SELECT 'agenda'    AS module_slug, 'Ver por lugar'       AS name, 'agenda.by-place'       AS slug, 'Consultar personal por sede/lugar'                AS description, 0 AS admin_only UNION ALL
    SELECT 'employees',                'Asignar rol',                 'employees.assign-role',         'Elegir el rol de sistema al crear/actualizar',                 0 UNION ALL
    SELECT 'employees',                'Restaurar empleados',         'employees.restore',             'Ver, modificar y restaurar empleados eliminados',              1 UNION ALL
    SELECT 'users',                    'Gestionar permisos',          'users.permissions',             'Conceder o revocar permisos de módulos a usuarios',            1
) x
JOIN `modules` m ON m.slug = x.module_slug AND m.deleted_at IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM `permissions` p
    WHERE p.module_id = m.id AND p.slug = x.slug AND p.deleted_at IS NULL
);

-- Normalizar textos (idempotente)
UPDATE `permissions` SET `description` = 'Conceder o revocar permisos de módulos a usuarios' WHERE `slug` = 'users.permissions';

-- Asegurar banderas admin_only
UPDATE `permissions` SET `admin_only` = 1 WHERE `slug` IN ('employees.restore', 'users.permissions');

-- -------------------------------------------------------------------------
-- 4. Entradas del menú (permiso -> ruta Angular)
-- -------------------------------------------------------------------------
UPDATE `permissions` SET `route` = NULL, `menu_label` = NULL, `sort_order` = 0;

UPDATE `permissions` SET `route` = '/contacts/admin/by-staff',        `menu_label` = 'Trabajador',          `sort_order` = 1 WHERE `slug` = 'agenda.view';
UPDATE `permissions` SET `route` = '/contacts/admin/by-place',        `menu_label` = 'Lugar',               `sort_order` = 2 WHERE `slug` = 'agenda.by-place';
UPDATE `permissions` SET `route` = '/contacts/admin/by-create',       `menu_label` = 'Nuevo usuario',       `sort_order` = 1 WHERE `slug` = 'employees.create';
UPDATE `permissions` SET `route` = '/contacts/admin/by-departments',  `menu_label` = 'Departamentos',       `sort_order` = 1 WHERE `slug` = 'departments.view';
UPDATE `permissions` SET `route` = '/contacts/admin/by-company-line', `menu_label` = 'Líneas corporativas', `sort_order` = 1 WHERE `slug` = 'phone-lines.view';
UPDATE `permissions` SET `route` = '/contacts/admin/by-create-line',  `menu_label` = 'Crear línea',         `sort_order` = 2 WHERE `slug` = 'phone-lines.create';
UPDATE `permissions` SET `route` = '/contacts/admin/permissions',     `menu_label` = 'Permisos de usuario', `sort_order` = 1 WHERE `slug` = 'users.permissions';

-- -------------------------------------------------------------------------
-- 5. Permisos por rol
--    1 Administrador : todos (además el backend lo trata como acceso total)
--    2 Supervisor    : agenda, empleados (ver/crear/actualizar/eliminar soft + asignar rol),
--                      departamentos y líneas (ver/crear/actualizar)
--    3 Operador      : agenda, empleados (ver/crear/actualizar) - sin asignar rol
--    4 Consulta      : agenda (solo lectura)
-- -------------------------------------------------------------------------
INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.deleted_at IS NULL
WHERE r.deleted_at IS NULL
  AND (
        r.slug = 'admin'
     OR (r.slug = 'supervisor' AND p.slug IN (
            'agenda.view','agenda.by-place',
            'employees.view','employees.create','employees.update','employees.delete','employees.assign-role',
            'departments.view','departments.create','departments.update',
            'phone-lines.view','phone-lines.create','phone-lines.update'))
     OR (r.slug = 'operator' AND p.slug IN (
            'agenda.view','agenda.by-place',
            'employees.view','employees.create','employees.update'))
     OR (r.slug = 'viewer' AND p.slug IN ('agenda.view','agenda.by-place'))
  )
  AND NOT EXISTS (
        SELECT 1 FROM `role_permissions` rp
        WHERE rp.role_id = r.id AND rp.permission_id = p.id AND rp.deleted_at IS NULL
  );

-- -------------------------------------------------------------------------
-- 6. Vista informativa de permisos efectivos (rol + concedidos - revocados)
--    Nota: el backend además trata al rol 'admin' como acceso total y
--    restringe los permisos admin_only al rol admin.
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW `v_user_effective_permissions` AS
SELECT
    u.id        AS user_id,
    p.id        AS permission_id,
    p.slug      AS permission_slug,
    m.slug      AS module_slug,
    CASE WHEN up.effect = 'grant' THEN 'user' ELSE 'role' END AS source
FROM `users` u
JOIN `permissions` p ON p.status = 1 AND p.deleted_at IS NULL
JOIN `modules` m     ON m.id = p.module_id AND m.status = 1 AND m.deleted_at IS NULL
LEFT JOIN `user_permissions` up
       ON up.user_id = u.id AND up.permission_id = p.id AND up.deleted_at IS NULL
WHERE u.status = 1
  AND u.deleted_at IS NULL
  AND (up.effect IS NULL OR up.effect <> 'revoke')
  AND (
        up.effect = 'grant'
     OR EXISTS (
            SELECT 1
            FROM `user_roles` ur
            JOIN `roles` r             ON r.id = ur.role_id AND r.status = 1 AND r.deleted_at IS NULL
            JOIN `role_permissions` rp ON rp.role_id = r.id AND rp.permission_id = p.id AND rp.deleted_at IS NULL
            WHERE ur.user_id = u.id AND ur.deleted_at IS NULL
        )
  );

COMMIT;
