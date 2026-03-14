ALTER TABLE tribology_data ADD COLUMN probe_material VARCHAR(255);
ALTER TABLE tribology_data ADD COLUMN probe_geometry VARCHAR(100);
ALTER TABLE tribology_data ADD COLUMN probe_radius VARCHAR(100);
ALTER TABLE tribology_data ADD COLUMN probe_roughness VARCHAR(100);
ALTER TABLE tribology_data ADD COLUMN substrate_material VARCHAR(255);
ALTER TABLE tribology_data ADD COLUMN substrate_coating VARCHAR(255);
ALTER TABLE tribology_data ADD COLUMN substrate_roughness VARCHAR(100);

UPDATE tribology_data
SET substrate_material = COALESCE(NULLIF(substrate_material, ''), material_name)
WHERE material_name IS NOT NULL AND TRIM(material_name) != '';

UPDATE tribology_data
SET substrate_roughness = COALESCE(NULLIF(substrate_roughness, ''), surface_roughness)
WHERE surface_roughness IS NOT NULL AND TRIM(surface_roughness) != '';
