-- CHARLIE-01 first (no coordinator)
INSERT INTO resources (id, event_id, resource, resource_type, geom, user_email)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  '11111111-0000-0000-0000-000000000001',
  'CHARLIE-01', 'LDC',
  ST_SetSRID(ST_MakePoint(12.4796898,41.8762663), 4326),
  'charlie1@prova.it'
);

-- ASM-01 coordinated by CHARLIE-01
INSERT INTO resources (id, event_id, resource, resource_type, geom, user_email, coordinator_id)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000002',
  '11111111-0000-0000-0000-000000000001',
  'ASM-01', 'ASM',
  ST_SetSRID(ST_MakePoint(12.4796898,41.8762663), 4326),
  'asm1@prova.it',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- ASM-02 coordinated by CHARLIE-01
INSERT INTO resources (id, event_id, resource, resource_type, geom, user_email, coordinator_id)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000003',
  '11111111-0000-0000-0000-000000000001',
  'ASM-02', 'ASM',
  ST_SetSRID(ST_MakePoint(12.4796898,41.8762663), 4326),
  'asm2@prova.it',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

-- ASM-03 coordinated by CHARLIE-01
INSERT INTO resources (id, event_id, resource, resource_type, geom, user_email, coordinator_id)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000004',
  '11111111-0000-0000-0000-000000000001',
  'ASM-03', 'ASM',
  ST_SetSRID(ST_MakePoint(12.4796898,41.8762663), 4326),
  'asm3@prova.it',
  'aaaaaaaa-0000-0000-0000-000000000001'
);


-- SAP-01 coordinated by CHARLIE-01
INSERT INTO resources (id, event_id, resource, resource_type, geom, user_email, coordinator_id)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000005',
  '11111111-0000-0000-0000-000000000001',
  'SAP-01', 'SAP',
  ST_SetSRID(ST_MakePoint(12.4796898,41.8762663), 4326),
  'sap1@prova.it',
  'aaaaaaaa-0000-0000-0000-000000000001'
);


INSERT INTO resources (id, event_id, resource, resource_type, geom, user_email, coordinator_id)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000006',
  '11111111-0000-0000-0000-000000000001',
  'SAP-02', 'SAP',
  ST_SetSRID(ST_MakePoint(12.4796898,41.8762663), 4326),
  'sap2@prova.it',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

INSERT INTO resources (id, event_id, resource, resource_type, geom, user_email, coordinator_id)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000007',
  '11111111-0000-0000-0000-000000000001',
  'SAP-03', 'SAP',
  ST_SetSRID(ST_MakePoint(12.4796898,41.8762663), 4326),
  'sap3@prova.it',
  'aaaaaaaa-0000-0000-0000-000000000001'
);

--PMA
INSERT INTO resources (id, event_id, resource, resource_type, user_email)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000008',
  '11111111-0000-0000-0000-000000000001',
  'PMA-01', 'PMA',
  'pma1@prova.it'
);

INSERT INTO resources (id, event_id, resource, resource_type, user_email)
VALUES (
  'aaaaaaaa-0000-0000-0000-000000000009',
  '11111111-0000-0000-0000-000000000001',
  'PMA-02', 'PMA',
  'pma2@prova.it'
);

-- ASM-01 crew
INSERT INTO personnel (event_id, name, surname, CF, number, role, resource)
VALUES
  ('11111111-0000-0000-0000-000000000001',
   'Daniele', 'Di Carlo', 'FRRMRC90A01H501Z',
   '12312312312',
   'Medico', 'aaaaaaaa-0000-0000-0000-000000000002'),

  ('11111111-0000-0000-0000-000000000001',
   'Elisa', 'Gigiozzi', 'RCCSFO95B41H501X',
    '13453452626',
   'Autista', 'aaaaaaaa-0000-0000-0000-000000000002'),

  ('11111111-0000-0000-0000-000000000001',
   'Ludovica', 'Laugeni', 'CNTLCU88C15H501Y',
    '14252345626',
   'Infermiere', 'aaaaaaaa-0000-0000-0000-000000000002');

-- PMA-01 crew
INSERT INTO personnel (event_id, name, surname, CF, number, role, resource)
VALUES
  ('11111111-0000-0000-0000-000000000001',
   'Elena', 'Mangano', 'MRNNNA92D41H501W',
    '123562463426',
   'Medico', 'aaaaaaaa-0000-0000-0000-000000000005'),

  ('11111111-0000-0000-0000-000000000001',
   'Paolo', 'Greco', 'GRCPLA85E01H501V',
    '7635735235',
   'Soccorritore', 'aaaaaaaa-0000-0000-0000-000000000005'),

  ('11111111-0000-0000-0000-000000000001',
   'Elena', 'Bruno', 'BRNLNE91F41H501U',
    '5234526345673',
   'Infermiere', 'aaaaaaaa-0000-0000-0000-000000000005');

-- SAP-01 crew
INSERT INTO personnel (event_id, name, surname, CF, number, role, resource)
VALUES
  ('11111111-0000-0000-0000-000000000001',
   'Edoardo', 'Minnozzi', 'RSSGNN87G01H501T',
    '124214235235',
   'Soccorritore', 'aaaaaaaa-0000-0000-0000-000000000004'),

  ('11111111-0000-0000-0000-000000000001',
   'Nathan', 'Clay', 'SPSCRH93H41H501S','23434654767',
   'OPEM', 'aaaaaaaa-0000-0000-0000-000000000004'),

  ('11111111-0000-0000-0000-000000000001',
   'Davide', 'Romano', 'RMNDVD89I01H501R', '33333333333',
   'OPEM', 'aaaaaaaa-0000-0000-0000-000000000004');

-- CHARLIE-01 crew
INSERT INTO personnel (event_id, name, surname, CF, number, role, resource)
VALUES
  ('11111111-0000-0000-0000-000000000001',
   'Roberto', 'Costa', 'CSTRRT86L01H501Q', '234234234234',
   'Coordinatore', 'aaaaaaaa-0000-0000-0000-000000000001'),

  ('11111111-0000-0000-0000-000000000001',
   'Giulia', 'Fontana', 'FNTGLI94M41H501P', '2342355346346',
   'Coordinatore', 'aaaaaaaa-0000-0000-0000-000000000001');
