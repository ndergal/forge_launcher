'use strict';

const express = require('express');
const app = express();
const sq = require('sqlite3');
var db = new sq.Database('documents');
const bodyParser = require('body-parser');
app.use(bodyParser.text());
var cors = require('cors');
app.use(cors());
const fs = require('fs');
var child = require('child_process');
const http = require('http');
var YAML = require('yamljs');
const options = {
    socketPath: '/var/run/docker.sock',
    path: '/tasks'
};
db.run('CREATE TABLE IF NOT EXISTS documents(name TEXT NOT NULL UNIQUE, content TEXT NOT NULL)');

// route principal de welcome
app.get('/', (req, res) => {
    res.send('Bienvenue sur le lanceur de forge IGN.\n');
});

// ajouter une forge
app.post('/forge/add/:id', (req, res) => {
    try {
        fs.writeFileSync('./v3compliant.yml', req.body);
        child.execSync("docker stack deploy --compose-file v3compliant.yml v3compliant");
        //child.execSync("docker stack rm v3compliant");
        db.run(`INSERT INTO documents VALUES(?,?)`, [req.params.id, req.body], function (err) {
            if (err) {
                fs.unlinkSync('./v3compliant.yml');
                res.send('cannot add the file to the database :' + err.message);
                console.log(err.message);
            } else {
                fs.unlinkSync('./v3compliant.yml');
                res.send('YAML file added to the database.\n');
            }
        });
    } catch (err) {
        fs.unlinkSync('./v3compliant.yml');
        res.send(err.stderr);
    }
});

// modifier une forge
app.post('/forge/update/:id', (req, res) => {
    try {
        fs.writeFileSync('./v3compliant.yml', req.body);
        child.execSync("docker stack deploy --compose-file v3compliant.yml v3compliant");
        db.run(`UPDATE documents SET content = ? where name = ?`, [req.body, req.params.id], function (err) {
            if (err) {
                fs.unlinkSync('./v3compliant.yml');
                res.send('cannot add the file to the database :' + err.message);
            } else {
                fs.unlinkSync('./v3compliant.yml');
                res.send('Done.\n');
            }
        });
    } catch (err) {
        fs.unlinkSync('./v3compliant.yml');
        res.send(err.stderr);
    }
});


// lister les forges
app.get('/forges/list', (req, res) => {
    db.all("SELECT * FROM documents", (err, rows) => {
        if (err) {
            res.send("cannot retrieve data : " + err.message);
        } else {
            let jsonObj = {
                forges: {}
            }
            rows.forEach(element => {
                jsonObj.forges[element.name] = element.content;
            });
            res.send(jsonObj);
        }
    });
});

// lancer une forge
app.get('/forge/launch/:id/:name', (req, res) => {
    db.get("SELECT content FROM documents WHERE name= '" + req.params.id + "'", (err, result) => {
        if (err) {
            res.send("No document found named : " + req.params.id);
            console.log(err);
        } else {
            if (result != undefined) {
                fs.writeFileSync('./test-overwrite.yml', result.content);
                try {
                    let buff = child.execSync("docker stack deploy --compose-file test-overwrite.yml " + req.params.name)
                    res.send(buff);
                } catch (err) {
                    res.send(err.stderr);
                }
            } else {
                res.send("no forge named " + req.params.id + " found.\n");
            }

        }
    });
});

// supprimer une forge
app.delete('/forge/delete/:id', (req, res) => {
    db.run("DELETE FROM documents WHERE name=\"" + req.params.id + "\"", (err) => {
        if (err) {
            res.send("cannot delete : " + err.message);
        } else {
            res.send("document " + req.params.id + " deleted from the database.\n");
        }
    })
});

// stopper une forge
app.delete('/forge/stop/:id', (req, res) => {
    try {
        let buff = child.execSync("docker stack rm " + req.params.id)
        if (buff != "") {
            res.send(buff);
        } else {
            res.send("cannot stop : " + req.params.id)
        }

    } catch (err) {
        res.send("error : " + err.stderr);
    }
});

// recuperer une forge
app.get('/forge/:id', (req, res) => {
    db.get("SELECT content FROM documents WHERE name= '" + req.params.id + "'", (err, result) => {
        if (err) {
            res.send("No document found named : " + req.params.id);
            console.log(err);
        } else {
            if (result != undefined) {
                res.send(result.content);
            } else {
                res.send("no result found\n");
            }

        }
    });
});

//recuperer forge en json
app.get('/forge/json/:id', (req, res) => {
    db.get("SELECT content FROM documents WHERE name= '" + req.params.id + "'", (err, result) => {
        if (err) {
            res.send("No document found named : " + req.params.id);
            console.log(err);
        } else {
            if (result != undefined) {
                res.send(YAML.parse(result.content));
            } else {
                res.send("no result found\n");
            }
        }
    });
});

// get les services running
app.get('/forges/running', (req, res) => {
    var services = [];
    var set = new Set();
    var idhost = [];
    http.get(options, resp => {
        var body = '';
        resp.on('data', (chunk) => {
            body += chunk;
        }).on('end', () => {
            var respArr = JSON.parse(body + '');
            respArr.forEach((value) => {
                if (value.Status.State == "running") {
                    var obj = {};
                    obj.ServiceID = value.ServiceID;
                    obj.NodeId = value.NodeID;
                    set.add(value.NodeID);
                    services.push(obj);
                }
            });
            let promises = [];
            set.forEach(id => {
                promises.push(new Promise((resolve, reject) => {
                    http.get({
                        socketPath: '/var/run/docker.sock',
                        path: '/nodes/' + id
                    }, resp => {
                        var body = '';
                        resp.on('data', (chunk) => {
                            body += chunk;
                        }).on('end', () => {
                            var resp = JSON.parse(body + '');
                            idhost[id] = resp.Description.Hostname;
                            resolve("test")
                        }).on('error', data => {
                            console.log(data);
                            reject(data);
                        });
                    });
                }))
            });
            Promise.all(promises).then(() => {
                let promises2 = [];
                services.forEach(e => {
                    e.Hostname = idhost[e.NodeId];
                    promises2.push(new Promise((resolve, reject) => {
                        http.get({
                            socketPath: '/var/run/docker.sock',
                            path: '/services/' + e.ServiceID
                        }, resp => {
                            var body = '';
                            resp.on('data', (chunk) => {
                                body += chunk;
                            }).on('end', () => {
                                var resp = JSON.parse(body + '');
                                if (resp.Spec != undefined) {
                                    if (resp.Spec.EndpointSpec.Ports != undefined) {
                                        e.Ports = resp.Spec.EndpointSpec.Ports;
                                    }
                                    e.Name = resp.Spec.Name;
                                    e.ServiceNamespace = resp.Spec.Labels["com.docker.stack.namespace"];
                                }
                                resolve("test")
                            }).on('error', data => {
                                console.log(data);
                                reject(data);
                            });
                        });
                    }));
                });
                Promise.all(promises2).then(() => {
                    services = services.filter(service => service.Name != undefined && service.ServiceNamespace != "v3compliant");
                    res.send(services);
                }).catch(err => {
                    console.error(err.message);
                    res.send("error : " + err.message);
                });
            }).catch(err => {
                console.error(err.message);
                res.send("error : " + err.message);
            });
        }).on('error', data => {
            console.error(data);
            res.send("error : " + data);
        });
    });
});

app.listen(3000, () =>
    console.log('RESTful API listening on port 3000!')
);

// data pas vide