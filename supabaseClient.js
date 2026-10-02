// Importar el cliente de Supabase desde CDN
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Reemplaza con tus credenciales reales de Supabase
const SUPABASE_URL = 'https://vvadrtvmjtqiyidwcjtn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2YWRydHZtanRxaXlpZHdjanRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MDIxNzEsImV4cCI6MjEwNjQ3ODE3MX0.qht5gjvSdA9A1b3iYricdLHtyHxHY-1hs8UAX2OdVgEeyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ2YWRydHZtanRxaXlpZHdjanRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA5MDIxNzEsImV4cCI6MjEwNjQ3ODE3MX0.qht5gjvSdA9A1b3iYricdLHtyHxHY-1hs8UAX2OdVgE';


export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
