require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
    const d = new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' });
    const tomorrow = new Date(d);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const startRange = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T00:00:00+08:00`;
    const endRange = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}T23:59:59.999+08:00`;
    const { data } = await supabase.from('reservations').select('id,room_id,is_notified').gte('start_time', startRange).lte('start_time', endRange);
    console.log('Bookings:', data);
    if (data && data.length) {
        const roomId = data[0].room_id;
        const { data: room } = await supabase.from('rooms').select('name, branch_id').eq('id', roomId).single();
        console.log('Room:', room);
        if (room) {
            const { data: branch } = await supabase.from('branches').select('name').eq('id', room.branch_id).single();
            console.log('Branch:', branch);
        }
    }
}
run();
