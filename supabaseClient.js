// Importar el cliente de Supabase desde CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Reemplaza con tus credenciales reales de Supabase
const SUPABASE_URL = 'https://quojhtninwgqnudmllvx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF1b2podG5pbndncW51ZG1sbHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4ODEzMzEsImV4cCI6MjEwNjQ1NzMzMX0.E-T4QQRgN11mJ-RZRlxQyfr5BOkUsFQKWmqJ5FN3JAE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);