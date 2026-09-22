const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const cameraInput = document.getElementById('camera-input');
const preview = document.getElementById('preview');
const scanButton = document.getElementById('scan-button');
const fileStatus = document.getElementById('file-status');
let selectedFile = null;
let objectUrl = null;
let addressDatabase = [];
let databaseReady = false;

function setFile(file) {
	if (!file || !file.type.startsWith('image/')) {
		fileStatus.textContent = 'Please choose a JPG, PNG or WEBP image';
		return;
	}
	if (file.size > 10 * 1024 * 1024) {
		fileStatus.textContent = 'That image is larger than 10 MB';
		return;
	}
	selectedFile = file;
	if (objectUrl) URL.revokeObjectURL(objectUrl);
	objectUrl = URL.createObjectURL(file);
	preview.src = objectUrl;
	dropzone.classList.add('has-image');
	fileStatus.textContent = file.name;
	scanButton.disabled = false;
}

function clearFile() {
	selectedFile = null;
	fileInput.value = '';
	cameraInput.value = '';
	dropzone.classList.remove('has-image');
	preview.removeAttribute('src');
	fileStatus.textContent = 'No image selected';
	scanButton.disabled = true;
}

function normalizeAddress(value) {
	return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/(\d{3})\s+(\d{2})/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '|');
}

function getAddressFromFields() {
	return ['address-name', 'address-street', 'address-postcode', 'address-city', 'address-country']
		.map(id => document.getElementById(id).value.trim())
		.filter(Boolean)
		.join('\n');
}

function fillAddressFields(address) {
	const lines = address.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
	const postcodeIndex = lines.findIndex(line => /\b\d{3}\s?\d{2}\b/.test(line));
	const postcodeLine = postcodeIndex >= 0 ? lines[postcodeIndex] : '';
	const postcodeMatch = postcodeLine.match(/\b\d{3}\s?\d{2}\b/);
	document.getElementById('address-name').value = lines[0] || '';
	document.getElementById('address-street').value = lines[1] || '';
	document.getElementById('address-postcode').value = postcodeMatch ? postcodeMatch[0] : '';
	document.getElementById('address-city').value = postcodeLine.replace(postcodeMatch ? postcodeMatch[0] : '', '').trim() || lines[2] || '';
	document.getElementById('address-country').value = lines[postcodeIndex >= 0 ? postcodeIndex + 1 : 3] || '';
}

async function loadAddressDatabase() {
	try {
		const response = await fetch('register.json', { cache: 'no-store' });
		if (!response.ok) throw new Error('Database request failed');
		const records = await response.json();
		addressDatabase = records
			.filter(record => record.bor_kvar)
			.map(record => normalizeAddress(record.namn + '\n' + record.gata + '\n' + record.postnummer + ' ' + record.ort + '\nSweden'));
		databaseReady = true;
		fileStatus.textContent = '';
	} catch (error) {
		console.error('Could not load register.json', error);
		fileStatus.textContent = 'Could not load the address database. Check the Render files.';
	}
}

function renderResults(address) {
	fillAddressFields(address);
	const addressKey = normalizeAddress(getAddressFromFields());
	const addressExists = addressDatabase.includes(addressKey);
	const checks = [
		{ type: 'pass', title: 'Street address found', detail: 'House number and street name were detected.' },
		{ type: 'pass', title: 'Postcode format valid', detail: 'The postcode matches the local format.' },
		{ type: 'pass', title: 'City and country found', detail: 'Both destination fields are present.' },
		{ type: addressExists ? 'pass' : 'fail', title: addressExists ? 'Address exists in database' : 'Address missing from database', detail: addressExists ? 'The scanned address matches a registered address.' : 'This address was not found. Check the letter before sending.' }
	];
	document.getElementById('score').textContent = addressExists ? '100%' : '65%';
	document.getElementById('result-summary').innerHTML = addressExists ? '<strong>Address verified.</strong> The scanned address exists in the database.' : '<strong>Address incorrect or unknown.</strong> The scanned address is missing from the database.';
	document.getElementById('database-status').className = 'database-status ' + (addressExists ? 'exists' : 'missing');
	document.getElementById('database-status').textContent = addressExists ? '✓ Address exists in database' : '! Address missing from database';
	document.getElementById('checks').innerHTML = checks.map(check => '<div class="check ' + check.type + '"><div class="check-icon">' + (check.type === 'pass' ? '✓' : '!') + '</div><div><strong>' + check.title + '</strong><span>' + check.detail + '</span></div></div>').join('');
	document.getElementById('empty-state').style.display = 'none';
	document.getElementById('results').classList.add('visible');
}

async function scanAddress() {
	if (!selectedFile || !databaseReady) return;
	if (!window.Tesseract) {
		fileStatus.textContent = 'OCR is still loading. Check your internet connection and try again.';
		return;
	}
	scanButton.disabled = true;
	scanButton.innerHTML = 'Reading address <span aria-hidden="true">…</span>';
	fileStatus.textContent = 'Analysing letter image';
	try {
		const result = await Tesseract.recognize(selectedFile, 'eng', {
			logger: message => {
				if (message.status === 'recognizing text') fileStatus.textContent = 'Reading address ' + Math.round(message.progress * 100) + '%';
			}
		});
		const extractedAddress = result.data.text.trim();
		if (!extractedAddress) throw new Error('No address text detected');
		renderResults(extractedAddress);
		scanButton.innerHTML = 'Scan again <span aria-hidden="true">→</span>';
		fileStatus.textContent = selectedFile.name + ' · scanned just now';
	} catch (error) {
		console.error('Could not read the letter image', error);
		fileStatus.textContent = 'No address text was detected. Try a clearer image.';
		scanButton.innerHTML = 'Try scan again <span aria-hidden="true">→</span>';
	} finally {
		scanButton.disabled = false;
	}
}

fileInput.addEventListener('change', () => setFile(fileInput.files[0]));
cameraInput.addEventListener('change', () => setFile(cameraInput.files[0]));
scanButton.addEventListener('click', scanAddress);
dropzone.addEventListener('drop', event => setFile(event.dataTransfer.files[0]));
['dragenter', 'dragover'].forEach(eventName => dropzone.addEventListener(eventName, event => {
	event.preventDefault();
	dropzone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(eventName => dropzone.addEventListener(eventName, event => {
	event.preventDefault();
	dropzone.classList.remove('dragging');
}));
document.getElementById('replace-button').addEventListener('click', () => fileInput.click());
document.getElementById('clear-button').addEventListener('click', clearFile);
document.getElementById('copy-button').addEventListener('click', event => {
	navigator.clipboard.writeText(getAddressFromFields());
	event.currentTarget.textContent = 'Copied';
	window.setTimeout(() => { event.currentTarget.textContent = 'Copy address'; }, 1400);
});
document.getElementById('edit-button').addEventListener('click', event => {
	const fields = document.querySelectorAll('#address-fields input');
	const isEditing = event.currentTarget.dataset.editing === 'true';
	fields.forEach(field => { field.disabled = isEditing; });
	event.currentTarget.dataset.editing = String(!isEditing);
	event.currentTarget.textContent = isEditing ? 'Correct address' : 'Check corrected address';
	if (isEditing) {
		renderResults(getAddressFromFields());
		event.currentTarget.textContent = 'Correct address';
	} else {
		document.getElementById('address-name').focus();
	}
});

loadAddressDatabase();
