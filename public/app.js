// API Base URL
const API_BASE = window.location.origin;

// DOM Elements
const statusText = document.getElementById('status-text');
const statusMessage = document.getElementById('status-message');
const qrContainer = document.getElementById('qr-code');
const qrMessage = document.getElementById('qr-message');
const qrSection = document.getElementById('qr-section');
const logoutBtn = document.getElementById('logout-btn');
const refreshStatusBtn = document.getElementById('refresh-status-btn');
const addNumberBtn = document.getElementById('add-number-btn');
const newNumberInput = document.getElementById('new-number-input');
const numberList = document.getElementById('number-list');

// State
let isConnected = false;
let statusCheckInterval = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 WhatsApp Receipt Reader UI loaded');
    loadStatus();
    loadWhitelist();
    startStatusPolling();

    // Event listeners
    refreshStatusBtn.addEventListener('click', () => {
        loadStatus();
        loadWhitelist();
    });

    logoutBtn.addEventListener('click', handleLogout);
    addNumberBtn.addEventListener('click', handleAddNumber);

    // Allow Enter key in input field
    newNumberInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleAddNumber();
        }
    });
});

// Start polling status every 5 seconds
function startStatusPolling() {
    statusCheckInterval = setInterval(() => {
        loadStatus();
    }, 5000);
}

// Stop polling
function stopStatusPolling() {
    if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
        statusCheckInterval = null;
    }
}

// Load WhatsApp connection status
async function loadStatus() {
    try {
        const response = await fetch(`${API_BASE}/status`);
        const data = await response.json();

        isConnected = data.ready;

        // Update status badge
        if (data.ready) {
            statusText.textContent = 'Connected';
            statusText.className = 'status-badge connected';
            statusMessage.textContent = data.message;

            // Hide QR, show logout button
            qrContainer.style.display = 'none';
            qrMessage.textContent = 'WhatsApp is connected';
            logoutBtn.style.display = 'inline-block';
        } else {
            statusText.textContent = 'Disconnected';
            statusText.className = 'status-badge disconnected';
            statusMessage.textContent = data.message;

            // Show QR code if available
            logoutBtn.style.display = 'none';
            if (data.qr_code) {
                displayQRCode(data.qr_code);
            } else {
                qrMessage.textContent = 'Initializing WhatsApp... Please wait.';
                qrContainer.innerHTML = '';
            }
        }
    } catch (error) {
        console.error('❌ Error loading status:', error);
        statusText.textContent = 'Error';
        statusText.className = 'status-badge disconnected';
        statusMessage.textContent = 'Failed to load status. Check if server is running.';
    }
}

// Display QR code
function displayQRCode(qrData) {
    qrMessage.textContent = '📱 Scan this QR code with WhatsApp:';

    // Use a QR code generation library (qrcodejs or similar)
    // For simplicity, we'll use a QR code API service
    const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;

    qrContainer.innerHTML = `<img src="${qrImageUrl}" alt="QR Code" />`;
    qrContainer.style.display = 'block';
}

// Handle logout
async function handleLogout() {
    if (!confirm('Are you sure you want to logout from WhatsApp?')) {
        return;
    }

    logoutBtn.disabled = true;
    logoutBtn.textContent = '⏳ Logging out...';

    try {
        const response = await fetch(`${API_BASE}/logout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ Logged out successfully! QR code will appear shortly.', 'success');

            // Reset status
            isConnected = false;
            statusText.textContent = 'Disconnected';
            statusText.className = 'status-badge disconnected';
            statusMessage.textContent = 'Logged out. Waiting for QR code...';

            // Wait a bit and reload status to get new QR
            setTimeout(() => {
                loadStatus();
            }, 2000);
        } else {
            showNotification('❌ Logout failed: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('❌ Logout error:', error);
        showNotification('❌ Network error during logout', 'error');
    } finally {
        logoutBtn.disabled = false;
        logoutBtn.textContent = '🚪 Logout';
    }
}

// Load whitelist names
async function loadWhitelist() {
    try {
        const response = await fetch(`${API_BASE}/whitelist`);
        const data = await response.json();

        if (data.success) {
            displayWhitelist(data.names || data.numbers || []);
        } else {
            numberList.innerHTML = '<p class="loading-text">Failed to load whitelist</p>';
        }
    } catch (error) {
        console.error('❌ Error loading whitelist:', error);
        numberList.innerHTML = '<p class="loading-text">Error loading whitelist</p>';
    }
}

// Display whitelist names
function displayWhitelist(names) {
    if (names.length === 0) {
        numberList.innerHTML = '<p class="loading-text">No names in whitelist</p>';
        return;
    }

    numberList.innerHTML = names.map(name => `
        <div class="number-item">
            <span class="number-text">${name}</span>
            <button class="btn btn-remove" onclick="handleRemoveName('${name.replace(/'/g, "\\'")}')
                🗑️ Remove
            </button>
        </div>
    `).join('');
}

// Handle add name
async function handleAddNumber() {
    const name = newNumberInput.value.trim();

    if (!name) {
        showNotification('⚠️ Please enter a display name', 'warning');
        return;
    }

    // Basic validation - allow any non-empty string
    if (name.length < 1) {
        showNotification('⚠️ Name cannot be empty', 'warning');
        return;
    }

    addNumberBtn.disabled = true;
    addNumberBtn.textContent = '⏳ Adding...';

    try {
        const response = await fetch(`${API_BASE}/whitelist/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ Name added successfully!', 'success');
            newNumberInput.value = '';
            loadWhitelist();
        } else {
            showNotification('❌ Failed to add name: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('❌ Error adding name:', error);
        showNotification('❌ Network error while adding name', 'error');
    } finally {
        addNumberBtn.disabled = false;
        addNumberBtn.textContent = '➕ Add Name';
    }
}

// Handle remove name
async function handleRemoveName(name) {
    if (!confirm(`Are you sure you want to remove ${name} from the whitelist?`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/whitelist/remove`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification('✅ Name removed successfully!', 'success');
            loadWhitelist();
        } else {
            showNotification('❌ Failed to remove name: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('❌ Error removing name:', error);
        showNotification('❌ Network error while removing name', 'error');
    }
}

// Show notification
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;

    // Add styles
    Object.assign(notification.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        padding: '15px 25px',
        borderRadius: '8px',
        color: 'white',
        fontWeight: '600',
        zIndex: '9999',
        animation: 'slideIn 0.3s ease-out',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
        maxWidth: '400px'
    });

    // Set background color based on type
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#3b82f6'
    };
    notification.style.background = colors[type] || colors.info;

    // Add to body
    document.body.appendChild(notification);

    // Remove after 4 seconds
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 4000);
}

// Add CSS for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopStatusPolling();
});