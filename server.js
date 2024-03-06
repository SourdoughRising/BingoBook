const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Set up multer for file handling
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/'); // Ensure this directory exists
    },
    filename: function (req, file, cb) {
        cb(null, file.fieldname + '-' + Date.now());
    }
});
const upload = multer({ storage: storage });

// Initialize SQLite database
const db = new sqlite3.Database('bingobook.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the SQLite database.');
});

// Start the Express server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

db.serialize(() => {
    //create entries timesheet table
    db.run(`CREATE TABLE IF NOT EXISTS entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              firstName TEXT,
              lastName TEXT,
              roomNumber INT,
              additionalText TEXT,
              images TEXT
            )`);
});


// Endpoint to fetch timesheet rows for a given entryId
app.get('/timesheets/:entryId', (req, res) => {
    const { entryId } = req.params;
    const sql = `SELECT * FROM timesheets WHERE entryId = ? ORDER BY timesheetRow ASC`;

    db.all(sql, [entryId], (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Error fetching timesheets data');
            return;
        }
        res.json(rows);
    });
});

app.post('/submit-data', upload.array('images', 10), (req, res) => {
    // Process uploaded files and form fields
    const images = req.files.map(file => file.path); // Array of image paths
    const { firstName, lastName, roomNumber, additionalText } = req.body;

    // Insert data into the database
    db.run('INSERT INTO entries (firstName, lastName, roomNumber, additionalText, images) VALUES (?, ?, ?, ?, ?)',
        [firstName, lastName, roomNumber, additionalText, JSON.stringify(images)],
        function (err) {
            if (err) {
                res.status(500).send(err.message);
            } else {
                res.status(200).send(`Entry added with ID: ${this.lastID}`);
            }
        }
    );
});

app.get('/get-data', (req, res) => {
    let sql = 'SELECT * FROM entries';
    const params = [];

    if (req.query.q) {
        sql += " WHERE firstName LIKE ? OR lastName LIKE ? OR roomNumber LIKE ? OR additionalText LIKE ?";
        let query = '%' + req.query.q + '%';
        params.push(query, query, query, query);
    }

    db.all(sql, params, (err, rows) => {
        if (err) {
            res.status(500).send(err.message);
        } else {
            res.status(200).json(rows);
        }
    });
});

// Helper functions for Promisified database operations
function dbRunPromise(sql, params) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGetPromise(sql, params) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}


app.post('/update-data', (req, res) => {
    const { id, firstName, lastName, roomNumber, additionalText } = req.body;

    if (!id) {
        return res.status(400).send('ID is required');
    }

    const sql = 'UPDATE entries SET firstName = ?, lastName = ?, roomNumber = ?, additionalText = ? WHERE id = ?';
    const params = [firstName, lastName, roomNumber, additionalText, id];

    db.run(sql, params, function (err) {
        if (err) {
            console.error('Update error', err);
            res.status(500).json({ error: 'Failed to update entry' });
        } else {
            if (this.changes > 0) {
                res.status(200).json({ success: 'Entry updated', id: id });
            } else {
                res.status(404).json({ error: 'Entry not found' });
            }
        }
    });
});

// Endpoint to delete an image
app.post('/delete-image', (req, res) => {
    const { entryId, imageName } = req.body;

    const filename = path.basename(imageName);

    // Construct the full path to the image file
    const imagePath = path.join(__dirname, 'uploads', filename);

    // Remove the image from the filesystem
    fs.unlink(imagePath, (err) => {
        if (err) {
            console.error('File deletion error:', err);
            // Send a different status code for "not found"
            return res.status(err.code === 'ENOENT' ? 404 : 500).json({ error: 'Failed to delete image' });
        }

        // Update the database to remove the image from the entry's list
        db.get('SELECT images FROM entries WHERE id = ?', [entryId], (selectErr, row) => {
            if (selectErr) {
                console.error('Database select error:', selectErr);
                return res.status(500).json({ error: 'Failed to retrieve entry' });
            }

            let images = JSON.parse(row.images || '[]');
            images = images.filter(img => path.basename(img) !== filename);

            db.run('UPDATE entries SET images = ? WHERE id = ?', [JSON.stringify(images), entryId], (updateErr) => {
                if (updateErr) {
                    console.error('Database update error:', updateErr);
                    return res.status(500).json({ error: 'Failed to update entry' });
                }
                res.status(200).json({ success: 'Image deleted', images });
            });
        });
    });
});




app.post('/delete-data', (req, res) => {
    // Destructure the 'id' from the request body
    const { id } = req.body;

    // Convert 'id' to a number if it's a string
    const entryId = parseInt(id, 10);

    // Check if 'id' is a number after conversion
    if (isNaN(entryId)) {
        // If 'id' is not a number, respond with an error
        return res.status(400).json({ error: 'Invalid ID provided' });
    }

    // Delete the entry with the given 'id'
    db.run('DELETE FROM entries WHERE id = ?', entryId, function (err) {
        if (err) {
            // If there's an error deleting the entry, respond with an error
            console.error('Delete error', err);
            res.status(500).json({ error: 'Failed to delete entry' });
        } else {
            // If deletion is successful, respond with success
            if (this.changes > 0) {
                // 'this.changes' refers to the number of rows deleted
                res.status(200).json({ success: 'Entry deleted' });
            } else {
                // If no rows are deleted (e.g., the 'id' doesn't exist), respond with a different message
                res.status(404).json({ error: 'Entry not found' });
            }
        }
    });
});
// Endpoint to add an image
app.post('/add-image', upload.array('images', 10), async (req, res) => {
    console.log('Request body:', req.body);
    // 'req.body' should be populated with the text fields if 'multer' is set up correctly
    const entryId = req.body.entryId;
    const imageFiles = req.files; // 'req.files' will be an array of files

    if (!imageFiles || imageFiles.length === 0) {
        return res.status(400).json({ error: 'No image files provided' });
    }

    console.log(`Adding images for entryId: ${entryId}`); // Debug log

    try {
        // Get the current images from the database
        const row = await dbGetPromise('SELECT images FROM entries WHERE id = ?', [entryId]);
        let images = row && row.images ? JSON.parse(row.images) : [];

        // Add the new image paths to the existing images array
        const newImagePaths = imageFiles.map(file => `/uploads/${file.filename}`);
        images = [...images, ...newImagePaths];

        // Update the database entry with the new array of images
        await dbRunPromise('UPDATE entries SET images = ? WHERE id = ?', [JSON.stringify(images), entryId]);

        // Send back the updated list of images to the client
        res.status(200).json({ success: 'New images added to entry', images: images });
    } catch (error) {
        console.error('Error updating entry with new images:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/timesheets/:rowId', (req, res) => {
    console.log("req.params = " + req.params);
    const rowId = req.params.rowId;

    // Assuming `rowId` maps to `roomId` for the sake of example. Adjust the query as needed.
    const sql = `SELECT * FROM timesheets WHERE entryId = ?`;

    db.all(sql, [rowId], (err, rows) => {
        if (err) {
            console.error(err.message);
            res.status(500).send('Error fetching timesheet data');
            return;
        }

        // Process the rows as needed, e.g., formatting dates
        const processedRows = rows.map(row => {
            // Example of processing, adjust according to your data structure
            return {
                timesheetRow: row.id, // Assuming 'id' is the primary key for timesheets
                signOut: row.signOutTime, // Assuming 'signOutTime' is the column name
                // Include other necessary data fields
            };
        });

        res.json(processedRows); // Send the processed rows back to the client
    });
});


app.get('/timesheets/get-current-row/:rowId', (req, res) => {
    const rowId = req.params.rowId;
    const sql = `
        SELECT * FROM timesheets
        WHERE entryId = ?
        ORDER BY timesheetRow DESC
        LIMIT 1
    `;

    db.get(sql, [rowId], (err, row) => {
        if (err) {
            // Handle error
            res.status(500).send("Error fetching data from the database");
        } else {
            // If row is found, send it back as JSON
            if (row) {
                res.json(row);
            } else {
                res.status(404).send("Row not found");
            }
        }
    });
});


// Endpoint to handle signIn operation
app.post('/timesheets/newRow', (req, res) => {
    const { entryId, timesheetRow } = req.body;

    const sql = "INSERT INTO timesheets (entryId, timesheetRow) VALUES (?, ?)";

    db.run(sql, [entryId, timesheetRow], function (err) {
        if (err) {
            console.error(err.message);
            res.status(500).send('Error on signIn');
        } else {
            res.status(200).send({ message: 'SignIn successful', timesheetId: this.lastID });
        }
    });
});

app.post('/timesheets/signIn', (req, res) => {
    // Update the existing latest timesheet row
    const { entryId, timesheetRow, roomNumber, signIn } = req.body;
    const sql = "UPDATE timesheets SET roomNumber = ?, signIn = ? WHERE entryId = ? AND timesheetRow = ?";
    //console.log(`submitting roomNumber: ${roomNumber}, signIn: ${signIn}, entryId: ${entryId}, timesheetRow: ${timesheetRow}`)
    db.run(sql, [roomNumber, signIn, entryId, timesheetRow], function (err) {
        if (err) {
            console.error(err.message);
            res.status(500).send('Error on signIn');
        } else {
            res.status(200).send({ message: 'SignIn successful', timesheetId: this.lastID });
        }
    });
});

app.post('/timesheets/signOut', (req, res) => {

    // Assuming you're receiving the entryId and the sign-out time from the request body
    const { entryId, timesheetRow, signOut } = req.body;
    // SQL query to update the signOut column for the latest timesheetRow for a given entryId
    const updateSql = `
    UPDATE timesheets 
    SET signOut = ? 
    WHERE entryId = ? 
    AND timesheetRow = ?
    `;

    // Run the update query with the provided signOutTime and entryId
    db.run(updateSql, [signOut, entryId, timesheetRow], function (err) {
        if (err) {
            // If an error occurs, log it and send a 500 Internal Server Error response
            console.error('Error updating sign-out time:', err.message);
            res.status(500).send('Error updating sign-out time');
        } else {
            // If successful, send back a 200 OK response with a success message
            // this.changes returns the number of rows affected
            if (this.changes > 0) {
                res.status(200).send({ message: 'Sign-out successful' });
            } else {
                // If no rows were updated, it means the entryId didn't match any rows
                res.status(404).send({ message: 'Timesheet entry not found' });
            }
        }
    });
});

app.delete('/timesheets/deleteRow', (req, res) => {
    const { entryId, timesheetRow } = req.body;
    const sql = "DELETE FROM timesheets WHERE entryId = ? AND timesheetRow = ?";
    db.run(sql, [entryId, timesheetRow], function (err) {
        if (err) {
            console.error(err.message);
            res.status(500).send('Error on delete');
        } else {
            res.status(200).send({ message: 'Row deleted successfully', deletedRowId: entryId });
        }
    });
});

app.post('/timesheets/updateRow', (req, res) => {
    const { entryId, timesheetRow, roomNumber, signIn, signOut } = req.body;
    const sql = `
        UPDATE timesheets 
        SET roomNumber = ?, signIn = ?, signOut = ? 
        WHERE entryId = ? AND timesheetRow = ?
    `;
    db.run(sql, [roomNumber, signIn, signOut, entryId, timesheetRow], function (err) {
        if (err) {
            console.error('Error updating timesheet:', err.message);
            res.status(500).send('Error updating timesheet');
        } else {
            res.status(200).send({ message: 'Timesheet updated successfully' });
        }
    });
});


//ONE TIME FUNCTIONS
//add roomNumber column
// db.serialize(() => {
//     db.run(`ALTER TABLE entries ADD COLUMN roomNumber INT`);
// });

//set room number values from additional text values
// db.serialize(() => {
//     db.each("SELECT id, additionalText FROM entries", (err, row) => {
//       if (err) {
//         console.error(err);
//         return;
//       }

//       // Regular expression to match a # followed by four digits
//       const roomNumberMatch = row.additionalText.match(/#(\d{4})/);
//       if (roomNumberMatch) {
//         const roomNumber = roomNumberMatch[1]; // This is the extracted room number

//         // Update the roomNumber field for this entry
//         db.run("UPDATE entries SET roomNumber = ? WHERE id = ?", [roomNumber, row.id], (updateErr) => {
//           if (updateErr) {
//             console.error(`Error updating entry ${row.id}:`, updateErr);
//           } else {
//             console.log(`Entry ${row.id} updated with room number: ${roomNumber}`);
//           }
//         });
//       }
//     });
//   });

// Function to initialize the timesheets table and populate it
function initializeTimesheets() {
    db.serialize(() => {
        // Create the timesheets table
        db.run(`CREATE TABLE IF NOT EXISTS timesheets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entryId INTEGER NOT NULL,
            timesheetRow INTEGER NOT NULL,
            roomNumber INTEGER,
            signIn TEXT,
            signOut TEXT,
            FOREIGN KEY (entryId) REFERENCES entries(id)
        );`
        );
    })


    // Insert a row for every entry in the entries table with timesheetRow = 0
    db.run(`INSERT INTO timesheets (entryId, timesheetRow, roomNumber, signIn, signOut)
                SELECT id, 0, NULL, NULL, NULL FROM entries
                WHERE NOT EXISTS (SELECT 1 FROM timesheets WHERE timesheets.entryId = entries.id AND timesheets.timesheetRow = 0);`, function (err) {
        if (err) {
            console.error('Error initializing timesheets:', err);
        } else {
            console.log(`Rows inserted: ${this.changes}`);
        }
    });
    // Trigger for entry insertions
    const createTriggerSql = `
    CREATE TRIGGER IF NOT EXISTS after_entry_insert
    AFTER INSERT ON entries
    BEGIN
    INSERT INTO timesheets (entryId, timesheetRow, roomNumber, signIn, signOut)
    VALUES (NEW.id, 0, NULL, NULL, NULL);
    END;
`;
    //Trigger for entry deletions
    const deleteTriggerSql = `
    CREATE TRIGGER IF NOT EXISTS after_entry_delete
    AFTER DELETE ON entries
    FOR EACH ROW
    BEGIN
        DELETE FROM timesheets WHERE entryId = OLD.id;
    END;
    
`;

    //Trigger for maintaining timesheetRow0

    const zeroRowTriggerSql = `
    CREATE TRIGGER IF NOT EXISTS after_last_timesheetRow_delete
    AFTER DELETE ON timesheets
    FOR EACH ROW
    WHEN (SELECT COUNT(*) FROM timesheets WHERE entryId = OLD.entryId) = 0
    BEGIN
        INSERT INTO timesheets (entryId, timesheetRow)
        VALUES (OLD.entryId, 0);
    END;
`;

    db.run(createTriggerSql, function (err) {
        if (err) {
            console.error('Error creating trigger:', err.message);
        } else {
            console.log('Create Trigger created successfully');
        }
    });

    db.run(deleteTriggerSql, function (err) {
        if (err) {
            console.error('Error creating trigger:', err.message);
        } else {
            console.log('Delete Trigger created successfully');
        }
    })

    db.run(zeroRowTriggerSql, function (err) {
        if (err) {
            console.error('Error creating trigger:', err.message);
        } else {
            console.log('Zero Row Trigger created successfully');
        }
    })
}

// Call the function to initialize and populate the timesheets table
initializeTimesheets();