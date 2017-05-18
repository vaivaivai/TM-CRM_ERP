/*
 2014-2016 ToManage
 
 NOTICE OF LICENSE
 
 This source file is subject to the Open Software License (OSL 3.0)
 that is bundled with this package in the file LICENSE.txt.
 It is also available through the world-wide-web at this URL:
 http://opensource.org/licenses/osl-3.0.php
 If you did not receive a copy of the license and are unable to
 obtain it through the world-wide-web, please send an email
 to license@tomanage.fr so we can send you a copy immediately.
 
 DISCLAIMER
 
 Do not edit or add to this file if you wish to upgrade ToManage to newer
 versions in the future. If you wish to customize ToManage for your
 needs please refer to http://www.tomanage.fr for more information.
 
 @author    ToManage SAS <contact@tomanage.fr>
 @copyright 2014-2016 ToManage SAS
 @license   http://opensource.org/licenses/osl-3.0.php Open Software License (OSL 3.0)
 International Registered Trademark & Property of ToManage SAS
 */


"use strict";

var mongoose = require('mongoose'),
    _ = require('lodash'),
    async = require('async'),
    moment = require('moment'),
    Iconv = require('iconv').Iconv;

var Dict = INCLUDE('dict');
var Latex = INCLUDE('latex');

exports.install = function() {

    var object = new Object();
    var billing = new Billing();

    F.route('/erp/api/delivery', object.read, ['authorize']);
    F.route('/erp/api/delivery/dt', object.readDT, ['post', 'authorize']);
    F.route('/erp/api/delivery/caFamily', object.caFamily, ['authorize']);
    F.route('/erp/api/delivery/statistic', object.statistic, ['post', 'json', 'authorize']);
    F.route('/erp/api/delivery/pdf/', object.pdfAll, ['post', 'json', 'authorize']);
    F.route('/erp/api/delivery/csv/', object.csvAll, ['post', 'json', 'authorize']);
    F.route('/erp/api/delivery/mvt/', object.csvMvt, ['post', 'json', 'authorize']);
    F.route('/erp/api/delivery/pdf/{deliveryId}', object.pdf, ['authorize']);

    // recupere la liste des courses pour verification
    F.route('/erp/api/delivery/billing', billing.read, ['authorize']);

    // Valid les BL en bloc
    F.route('/erp/api/delivery/validate', object.validAll, ['post', 'json', 'authorize']);
    // Genere la facturation des BL en groupe
    F.route('/erp/api/delivery/billing', billing.createAll, ['post', 'json', 'authorize']);

    F.route('/erp/api/delivery/billing/ca', billing.familyCA, ['authorize']);

    F.route('/erp/api/delivery', object.create, ['post', 'json', 'authorize'], 512);
    F.route('/erp/api/delivery/{deliveryId}', object.show, ['authorize']);
    F.route('/erp/api/delivery/{deliveryId}', function(id) {
        var self = this;
        if (self.query.method)
            switch (self.query.method) {
                case "clone":
                    object.clone(id, self);
                    break;
                case "bill":
                    billing.create(id, self);
                    break;
            }
    }, ['post', 'json', 'authorize'], 512);
    F.route('/erp/api/delivery/{deliveryId}', object.update, ['put', 'json', 'authorize'], 512);
    F.route('/erp/api/delivery/', object.destroyList, ['delete', 'authorize']);
    F.route('/erp/api/delivery/{deliveryId}', object.destroy, ['delete', 'authorize']);
    F.route('/erp/api/delivery/download/{:id}', object.download);
};

function Object() {}

// Read an offer
function Delivery(id, cb) {
    var DeliveryModel = MODEL('delivery').Schema;

    var self = this;

    //TODO Check ACL here
    var checkForHexRegExp = new RegExp("^[0-9a-fA-F]{24}$");
    var query = {};

    if (checkForHexRegExp.test(id))
        query = {
            _id: id
        };
    else
        query = {
            ref: id
        };

    //console.log(query);

    DeliveryModel.findOne(query, "-latex")
        .populate("contacts", "name phone email")
        .populate({
            path: "supplier",
            select: "name salesPurchases",
            populate: { path: "salesPurchases.priceList" }
        })
        .populate({
            path: "lines.product",
            select: "taxes info weight units",
            populate: { path: "taxes.taxeId" }
        })
        .populate({
            path: "total_taxes.taxeId"
        })
        .exec(cb);
}

Object.prototype = {
    show: function(id) {
        var self = this;
        Delivery(id, function(err, delivery) {
            if (err)
                console.log(err);

            self.json(delivery);
        });
    },
    create: function() {
        var DeliveryModel = MODEL('delivery').Schema;
        var self = this;

        var delivery = {};
        delivery = new DeliveryModel(self.body);

        delivery.editedBy = self.user._id;
        delivery.createdBy = self.user._id;

        if (!delivery.entity)
            delivery.entity = self.user.entity;

        //console.log(delivery);
        delivery.save(function(err, doc) {
            if (err)
                return console.log(err);

            self.json(doc);
        });
    },
    clone: function(id, self) {
        var DeliveryModel = MODEL('delivery').Schema;

        Delivery(id, function(err, doc) {
            var delivery = doc.toObject();

            delete delivery._id;
            delete delivery.__v;
            delete delivery.ref;
            delete delivery.createdAt;
            delete delivery.updatedAt;
            delete delivery.bill;
            delete delivery.history;
            delivery.Status = "DRAFT";
            delivery.notes = [];
            delivery.latex = {};
            delivery.datec = new Date();

            delivery = new DeliveryModel(delivery);
            delivery.editedBy = self.user._id;
            delivery.createdBy = self.user._id;

            if (delivery.entity == null)
                delivery.entity = self.user.entity;

            //console.log(delivery);
            delivery.save(function(err, doc) {
                if (err) {
                    return console.log(err);
                }

                self.json(doc);
            });
        });
    },
    update: function(id) {
        var self = this;
        Delivery(id, function(err, delivery) {

            console.log(delivery);
            delivery = _.extend(delivery, self.body);

            delivery.editedBy = self.user._id;

            delivery.save(function(err, doc) {
                if (err) {
                    console.log(err);
                    return self.json({
                        errorNotify: {
                            title: 'Erreur',
                            message: err
                        }
                    });
                }

                //console.log(doc);
                doc = doc.toObject();
                doc.successNotify = {
                    title: "Success",
                    message: "Bon de livraison enregistre"
                };
                self.json(doc);
            });
        });
    },
    destroy: function(id) {
        var DeliveryModel = MODEL('delivery').Schema;
        var self = this;

        DeliveryModel.update({
            _id: id
        }, { $set: { isremoved: true, Status: 'CANCELED', total_ht: 0, total_ttc: 0, total_tva: [] } }, function(err) {
            if (err) {
                self.throw500(err);
            } else {
                self.json({});
            }
        });
    },
    destroyList: function() {
        var DeliveryModel = MODEL('delivery').Schema;
        var self = this;

        if (!this.query.id)
            return self.throw500("No ids in destroy list");

        //var list = JSON.parse(this.query.id);
        var list = this.query.id;
        if (!list)
            return self.throw500("No ids in destroy list");

        var ids = [];

        if (typeof list === 'object')
            ids = list;
        else
            ids.push(list);

        DeliveryModel.remove({
            _id: { $in: ids }
        }, function(err) {
            if (err) {
                self.throw500(err);
            } else {
                self.json({});
            }
        });
    },
    readDT: function() {
        var self = this;
        var DeliveryModel = MODEL('delivery').Schema;

        var query = JSON.parse(self.req.body.query);

        //console.log(self.query);

        var conditions = {
            Status: { $ne: "BILLED" },
            isremoved: { $ne: true }
        };

        if (!query.search.value) {
            if (self.query.status_id && self.query.status_id !== 'null')
                conditions.Status = self.query.status_id;
        } else
            delete conditions.Status;

        if (!self.user.multiEntities)
            conditions.entity = self.user.entity;

        var options = {
            conditions: conditions,
            select: "client.id"
        };


        async.parallel({
            status: function(cb) {
                Dict.dict({
                    dictName: "fk_delivery_status",
                    object: true
                }, cb);
            },
            datatable: function(cb) {
                DeliveryModel.dataTable(query, options, cb);
            }
        }, function(err, res) {
            if (err)
                console.log(err);

            //console.log(res);

            for (var i = 0, len = res.datatable.data.length; i < len; i++) {
                var row = res.datatable.data[i];

                // Add checkbox
                res.datatable.data[i].bool = '<input type="checkbox" name="id[]" value="' + row._id + '"/>';
                // Add id
                res.datatable.data[i].DT_RowId = row._id.toString();
                if (res.datatable.data[i].Status === 'SEND')
                // Add color line 
                    res.datatable.data[i].DT_RowClass = "bg-green-turquoise";
                // Add link company
                // Add link company
                if (row.client && row.client.id)
                    res.datatable.data[i].client.name = '<a class="with-tooltip" href="#!/societe/' + row.client.id + '" data-tooltip-options=\'{"position":"top"}\' title="' + row.client.name + '"><span class="fa fa-institution"></span> ' + row.client.name + '</a>';
                else {
                    if (!row.client)
                        res.datatable.data[i].client = {};
                    res.datatable.data[i].client.name = '<span class="with-tooltip editable editable-empty" data-tooltip-options=\'{"position":"top"}\' title="Empty"><span class="fa fa-institution"></span> Empty</span>';
                }
                // Action
                res.datatable.data[i].action = '<a href="#!/delivery/' + row._id + '" data-tooltip-options=\'{"position":"top"}\' title="' + row.ref + '" class="btn btn-xs default"><i class="fa fa-search"></i> View</a>';
                // Add url on name
                res.datatable.data[i].ref = '<a class="with-tooltip" href="#!/delivery/' + row._id + '" data-tooltip-options=\'{"position":"top"}\' title="' + row.ref + '"><span class="fa fa-truck"></span> ' + row.ref + '</a>';
                // Convert Date
                res.datatable.data[i].datec = (row.datec ? moment(row.datec).format(CONFIG('dateformatShort')) : '');
                res.datatable.data[i].datedl = (row.datedl ? moment(row.datedl).format(CONFIG('dateformatShort')) : '');
                res.datatable.data[i].updatedAt = (row.updatedAt ? moment(row.updatedAt).format(CONFIG('dateformatShort')) : '');
                // Convert Status
                res.datatable.data[i].Status = (res.status.values[row.Status] ? '<span class="label label-sm ' + res.status.values[row.Status].cssClass + '">' + i18n.t(res.status.lang + ":" + res.status.values[row.Status].label) + '</span>' : row.Status);
            }

            //console.log(res.datatable);

            self.json(res.datatable);
        });
    },
    pdf: function(ref, self) {
        // Generation de la facture PDF et download

        if (!self)
            self = this;

        Delivery(ref, function(err, doc) {
            createDelivery2(doc, function(err, tex) {
                if (err)
                    return console.log(err);

                self.res.setHeader('Content-type', 'application/pdf');
                Latex.Template(null, doc.entity)
                    .on('error', function(err) {
                        console.log(err);
                        self.throw500(err);
                    })
                    .compile("main", tex)
                    .pipe(self.res)
                    .on('close', function() {
                        //console.log('document written');
                    });
            });
        });
    },
    pdfAll: function() {
        var self = this;

        var entity = this.body.entity;

        // Generation de la facture PDF et download
        var DeliveryModel = MODEL('delivery').Schema;

        var tabTex = [];

        DeliveryModel.find({ Status: "SEND", _id: { $in: self.body.id } })
            .populate("order", "ref ref_client total_ht datec")
            .populate({
                path: "lines.product.id",
                select: "ref name label weight pack",
                populate: { path: 'pack.id', select: "ref name label unit" }
            })
            .exec(function(err, deliveries) {
                if (err)
                    return console.log(err);

                if (!deliveries.length)
                    return self.json({ error: "No deliveries" });

                async.each(deliveries, function(delivery, cb) {

                    createDelivery2(delivery, function(err, tex) {
                        if (err)
                            return cb(err);
                        //console.log(tex);

                        tabTex.push({ id: delivery.ref, tex: tex });
                        cb();
                    });
                }, function(err) {
                    if (err)
                        return console.log(err);

                    var texOutput = "";

                    function compare(x, y) {
                        var a = parseInt(x.id.substring(x.id.length - 6, x.id.length), 10);
                        var b = parseInt(y.id.substring(y.id.length - 6, y.id.length), 10);

                        if (a < b)
                            return -1;
                        if (a > b)
                            return 1;
                        return 0;
                    }

                    tabTex.sort(compare);

                    for (var i = 0; i < tabTex.length; i++) {
                        if (i !== 0) {
                            texOutput += "\\newpage\n\n";
                            texOutput += "\\setcounter{page}{1}\n\n";
                        }

                        texOutput += tabTex[i].tex;
                    }

                    //console.log(texOutput);

                    self.res.setHeader('Content-type', 'application/pdf');
                    self.res.setHeader('x-filename', 'deliveries.pdf');
                    Latex.Template(null, entity)
                        .on('error', function(err) {
                            console.log(err);
                            self.throw500(err);
                        })
                        .compile("main", texOutput)
                        .pipe(self.res)
                        .on('close', function() {
                            console.log('documents written');
                        });
                });
            });
    },
    csvAll: function() {
        var self = this;
        var iconv = new Iconv('UTF-8', 'ISO-8859-1');

        /*format : code_client;name;address1;address2;zip;town;weight;ref*/

        // Generation de la facture PDF et download
        var DeliveryModel = MODEL('delivery').Schema;

        var Stream = require('stream');
        var stream = new Stream();

        var tabCsv = [];



        DeliveryModel.find({ Status: "SEND", _id: { $in: self.body.id } })
            .populate("client.id", "name code_client")
            .populate("order", "ref ref_client total_ht datec")
            .populate({
                path: "lines.product.id",
                select: "ref name label weight pack",
                populate: { path: 'pack.id', select: "ref name label unit" }
            })
            .exec(function(err, deliveries) {
                if (err)
                    return console.log(err);

                if (!deliveries.length)
                    return self.json({ error: "No deliveries" });

                async.each(deliveries, function(delivery, cb) {
                    var csv = "";
                    /*format : code_client;name;address1;address2;zip;town;weight;ref*/

                    csv += delivery.ref;
                    csv += ";" + delivery.name;
                    var address = delivery.address.split('\n');
                    if (address[0])
                        csv += ";" + address[0];
                    else
                        csv += ";";
                    if (address[1])
                        csv += ";" + address[1];
                    else
                        csv += ";";
                    csv += ";" + delivery.zip;
                    csv += ";" + delivery.town;
                    csv += ";" + MODULE('utils').printNumber(delivery.weight);
                    csv += ";" + delivery.ref;

                    tabCsv.push({ id: delivery.ref, csv: csv });
                    cb();

                }, function(err) {
                    if (err)
                        return console.log(err);

                    function compare(x, y) {
                        var a = parseInt(x.id.substring(x.id.length - 6, x.id.length), 10);
                        var b = parseInt(y.id.substring(y.id.length - 6, y.id.length), 10);

                        if (a < b)
                            return -1;
                        if (a > b)
                            return 1;
                        return 0;
                    }

                    tabCsv.sort(compare);

                    stream.emit('data', iconv.convert(tabCsv[0].csv));

                    for (var i = 1; i < tabCsv.length; i++)
                        stream.emit('data', iconv.convert("\n" + tabCsv[i].csv));

                    stream.emit('end');
                });
            });
        self.res.setHeader('x-filename', 'etiquettes.csv');
        self.stream('application/text', stream, "etiquettes.csv");
    },
    // List of product mouvement in stock form Deliveries
    csvMvt: function() {
        var self = this;
        var iconv = new Iconv('UTF-8', 'ISO-8859-1');
        /*format : ref;label;qty*/

        // Generation de la facture PDF et download
        var DeliveryModel = MODEL('delivery').Schema;
        var ProductModel = MODEL('product').Schema;

        var Stream = require('stream');
        var stream = new Stream();

        for (var i = 0; i < self.body.id.length; i++)
            self.body.id[i] = mongoose.Types.ObjectId(self.body.id[i]);

        var tabCsv = [];

        DeliveryModel.aggregate([
            { $match: { Status: "SEND", isremoved: { $ne: true }, _id: { $in: self.body.id } } },
            { $unwind: "$lines" },
            { $project: { _id: 0, lines: 1 } },
            { $group: { _id: "$lines.product.id", qty: { "$sum": "$lines.qty" } } }
        ], function(err, deliveries) {
            if (err)
                return console.log(err);

            if (!deliveries.length)
                return stream.emit('end');

            async.each(deliveries, function(delivery, cb) {
                ProductModel.findOne({ _id: delivery._id }, "ref label", function(err, product) {
                    var csv = "";

                    csv += product.ref;
                    csv += ";" + product.label;
                    csv += ";" + delivery.qty;

                    tabCsv.push({ id: product.ref, csv: csv });
                    cb();
                });

            }, function(err) {
                if (err)
                    return console.log(err);

                function compare(x, y) {
                    var a = parseInt(x.id.substring(x.id.length - 6, x.id.length), 10);
                    var b = parseInt(y.id.substring(y.id.length - 6, y.id.length), 10);

                    if (a < b)
                        return -1;
                    if (a > b)
                        return 1;
                    return 0;
                }

                tabCsv.sort(compare);

                stream.emit('data', iconv.convert(tabCsv[0].csv));

                for (var i = 1; i < tabCsv.length; i++)
                    stream.emit('data', iconv.convert("\n" + tabCsv[i].csv));

                stream.emit('end');
            });
        });
        self.res.setHeader('x-filename', 'mouvements.csv');
        self.stream('application/text', stream, "etiquettes.csv");
    },
    validAll: function() {
        var self = this;

        if (!self.body.id)
            return self.json({});

        var DeliveryModel = MODEL('delivery').Schema;

        DeliveryModel.update({ Status: "DRAFT", _id: { $in: self.body.id } }, { $set: { Status: 'SEND', updatedAt: new Date } }, { upsert: false, multi: true },
            function(err, doc) {
                if (err)
                    return self.throw500(err);

                self.json({});

            });
    },
    caFamily: function() {
        var self = this;
        var DeliveryModel = MODEL('delivery').Schema;
        var ProductModel = MODEL('product').Schema;

        var d = new Date();
        d.setHours(0, 0, 0);
        var dateStart = new Date(d.getFullYear(), parseInt(d.getMonth() - 1, 10), 1);
        var dateEnd = new Date(d.getFullYear(), d.getMonth(), 1);

        var ca = {};

        async.parallel({
            caFamily: function(cb) {
                    DeliveryModel.aggregate([
                        { $match: { Status: { '$ne': 'DRAFT' }, entity: self.user.entity, datec: { '$gte': dateStart, '$lt': dateEnd } } },
                        { $unwind: "$lines" },
                        { $project: { _id: 0, lines: 1 } },
                        { $group: { _id: "$lines.product.name", total_ht: { "$sum": "$lines.total_ht" } } }
                    ], function(err, doc) {
                        if (err) {
                            return cb(err);
                        }

                        //console.log(doc);
                        cb(null, doc);
                    });
                }
                /*familles: function(cb) {
                 CoursesModel.aggregate([
                 {$match: {Status: {'$ne': 'REFUSED'}, total_ht: {'$gt': 0}, date_enlevement: {'$gte': dateStart, '$lt': dateEnd}}},
                 {$project: {_id: 0, type: 1, total_ht: 1}},
                 {$group: {_id: "$type", sum: {"$sum": "$total_ht"}}}
                 ], function(err, doc) {
                 if (doc.length == 0)
                 return cb(0);
                 
                 //console.log(doc);
                 cb(null, doc);
                 });
                 }*/
        }, function(err, results) {
            if (err)
                return console.log(err);

            //console.log(results);
            async.each(results.caFamily, function(product, callback) {
                //console.log(product);
                ProductModel.findOne({ ref: product._id }, function(err, doc) {
                    if (!doc)
                        console.log(product);

                    product.caFamily = doc.caFamily;

                    if (typeof ca[doc.caFamily] === "undefined")
                        ca[doc.caFamily] = 0;

                    ca[doc.caFamily] += product.total_ht;
                    //console.log(ca);

                    callback();
                });

            }, function(err) {

                var result = [];
                for (var i in ca) {
                    result.push({
                        family: i,
                        total_ht: ca[i]
                    });
                }

                //console.log(results);

                self.json(result);
            });
        });
    },
    statistic: function() {
        var self = this;
        var DeliveryModel = MODEL('delivery').Schema;

        var ca = {};

        DeliveryModel.aggregate([
            { $match: self.body.query },
            { $project: { _id: 0, total_ht: 1, total_ht_subcontractors: 1 } },
            { $group: { _id: null, total_ht: { "$sum": "$total_ht" }, total_ht_subcontractors: { "$sum": "$total_ht_subcontractors" } } }
        ], function(err, doc) {
            if (err) {
                return console.log(err);
            }

            //console.log(doc);
            self.json(doc);
        });

    },
    download: function(id) {
        var self = this;
        var DeliveryModel = MODEL('delivery').Schema;

        var object = new Object();

        DeliveryModel.findOne({ _id: id }, function(err, delivery) {
            if (err)
                return self.throw500(err);

            if (!delivery)
                return self.view404('Delivery id not found');

            //var date = new Date();
            //order.updatedAt.setDate(order.updatedAt.getDate() + 15); // date + 15j, seulement telechargement pdt 15j

            //if (order.updatedAt < date)
            //    return self.view404('Order expired');

            object.pdf(id, self);

            delivery.history.push({
                date: new Date(),
                mode: 'email',
                msg: 'email pdf telecharge',
                Status: 'notify'
            });

            delivery.save();

        });
    }
};

/**
 * Calcul des donnees de facturation
 */

function Billing() {}

Billing.prototype = {
    read: function() {
        var self = this;
        var DeliveryModel = MODEL('delivery').Schema;

        var result = {
            GroupBL: {},
            GroupOrder: {}
        };

        var project = {};
        var fields = self.query.fields.split(" ");
        for (var i in fields) {
            project[fields[i].trim()] = 1;
        }

        DeliveryModel.aggregate([
                { $match: { Status: "SEND", entity: self.query.entity, datedl: { $lte: new Date(self.query.dateEnd) } } },
                { $project: project }
            ])
            .unwind('lines')

        //.populate("orders", "ref ref_client total_ht")
        .exec(function(err, docs) {
            if (err)
                return console.log(err);

            //console.log(docs);
            result.GroupBL = docs;
            self.json(result);
        });
    },
    create: function(id, self) {
        var DeliveryModel = MODEL('delivery').Schema;
        var FactureModel = MODEL('bill').Schema;
        var FactureSupplierModel = MODEL('billSupplier').Schema;

        if (!self)
            self = this;

        Delivery(id, function(err, delivery) {

            var bill = new FactureModel();

            bill.client = delivery.billing.societe;

            bill.price_level = delivery.price_level;
            bill.mode_reglement_code = delivery.mode_reglement_code;
            bill.cond_reglement_code = delivery.cond_reglement_code;
            bill.commercial_id = delivery.commercial_id;
            bill.datec = delivery.datedl;

            bill.entity = delivery.entity;

            bill.address = delivery.billing.address;
            bill.zip = delivery.billing.zip;
            bill.town = delivery.billing.town;

            bill.shipping = delivery.shipping;
            bill.ref_client = delivery.ref_client;

            bill.deliveries.push(delivery._id);
            if (delivery.order)
                bill.orders.push(delivery.order);

            // Date de prestation
            bill.dateOf = delivery.dateOf;
            bill.dateTo = delivery.dateTo;

            bill.lines = delivery.lines;

            delivery.Status = 'BILLED'; // class paye

            bill.save(function(err, bill) {
                if (err)
                    return self.throw500(err);

                delivery.bill = bill._id;
                delivery.save(function(err, delivery) {

                });

                self.json(bill);
            });


            // Add lines to supplier
            if (delivery.subcontractors.length > 0) {
                DeliveryModel.aggregate([
                    { '$match': { _id: delivery._id, total_ht_subcontractors: { '$gt': 0 } } },
                    { '$unwind': "$subcontractors" },
                    {
                        '$group': {
                            _id: {
                                fournisseur: "$subcontractors.societe",
                                type: "Intervention/Livraison",
                                client: "$client"
                            },
                            delivery_id: {
                                '$addToSet': {
                                    id: "$_id",
                                    name: "$ref"
                                }
                            },
                            lines: { '$addToSet': '$subcontractors' },
                            total_soustraitant: { '$sum': "$total_ht_subcontractors" }
                        }
                    }
                ], function(err, docs) {
                    if (err)
                        console.log(err);

                    async.each(docs, function(doc, cb) {
                        //console.log(doc);
                        FactureSupplierModel.findOne({ Status: "DRAFT", "supplier.id": doc._id.fournisseur.id }, {}, { sort: { 'createdAt': -1 } }, function(err, billSupplier) {
                            if (err)
                                return cb(err);

                            if (billSupplier == null) {
                                //console.log("New bill");
                                billSupplier = new FactureSupplierModel({
                                    supplier: {
                                        id: doc._id.fournisseur.id,
                                        name: doc._id.fournisseur.name
                                    },
                                    type: 'INVOICE_AUTO'
                                });

                                var date = new Date();
                                billSupplier.datec = new Date(date.getFullYear(), date.getMonth(), 0);

                                billSupplier.dateOf = new Date(date.getFullYear(), date.getMonth() - 1, 1);
                                billSupplier.dateTo = new Date(date.getFullYear(), date.getMonth(), 0);

                                billSupplier.entity = delivery.entity;

                                billSupplier.lines = [];
                            }

                            var product = {};
                            var line = {};

                            for (var i = 0, len = doc.lines.length; i < len; i++) {
                                line = doc.lines[i];
                                line.description += "\n" + doc._id.client.name;

                                for (var j = 0, len1 = doc.delivery_id.length; j < len1; j++)
                                    line.description += "\n" + doc.delivery_id[j].name;

                                if (line.total_ht !== 0)
                                    billSupplier.lines.push(line);
                            }

                            billSupplier.save(cb);
                        });
                    }, function(err, result) {

                        if (err)
                            return console.log(err);

                        console.log("Import supplier from delivery OK");
                    });

                });
            }
        });
        //res.send(200);
    },
    createAll: function() {
        var self = this;
        var DeliveryModel = MODEL('delivery').Schema;
        var FactureModel = MODEL('bill').Schema;
        var FactureSupplierModel = MODEL('billSupplier').Schema;
        var SocieteModel = MODEL('societe').Schema;
        //console.log(req.body.dateEnd);

        if (!this.body.id)
            return self.throw500("No ids in destroy list");

        //var list = JSON.parse(this.query.id);
        var list = this.body.id;
        if (!list)
            return self.throw500("No ids in destroy list");

        //console.log(list);

        list = _.map(list, function(id) {
            return mongoose.Types.ObjectId(id);
        });

        DeliveryModel.aggregate([
            { "$match": { Status: "SEND", _id: { $in: list } } },
            { "$project": { "datec": 1, datedl: 1, entity: 1, "shipping": 1, "lines": 1, "ref": 1, "societe": "$client.cptBilling" } },
            { "$sort": { datedl: 1 } },
            //{"$unwind": "$lines"},
            { "$group": { "_id": { societe: "$societe.id", entity: "$entity" }, "data": { "$push": "$$ROOT" } } }
        ], function(err, docs) {
            if (err)
                return console.log(err);

            //console.log(docs)

            // Creation des factures
            async.each(docs, function(client, callback) {

                SocieteModel.findOne({ _id: client._id.societe }, function(err, societe) {

                    var datec = new Date();

                    var facture = new FactureModel({
                        title: {
                            ref: "BL" + moment(datec).format(CONFIG('dateformatShort')),
                            autoGenerated: true
                        },
                        client: {
                            id: client._id.societe
                        },
                        type: 'INVOICE_AUTO'
                    });

                    if (societe == null)
                        console.log("Error : pas de societe pour le clientId : " + client._id);

                    facture.client.name = societe.name;
                    facture.price_level = societe.price_level;
                    facture.mode_reglement_code = societe.mode_reglement;
                    facture.cond_reglement_code = societe.cond_reglement;
                    facture.commercial_id = societe.commercial_id;
                    facture.datec = datec;

                    facture.entity = client._id.entity;

                    facture.address = societe.address;
                    facture.zip = societe.zip;
                    facture.town = societe.town;

                    facture.lines = [];

                    var deliveries_id = [];

                    for (var i = 0, len = client.data.length; i < len; i++) {
                        //console.log(client.data[i]);

                        if (client.data[i].lines)
                            for (var j = 0; j < client.data[i].lines.length; j++) {
                                var aline = client.data[i].lines[j];
                                aline.description += (aline.description ? "\n" : "") + client.data[i].ref + " (" + moment(client.data[i].datedl).format(CONFIG('dateformatShort')) + ")";
                                if (aline.qty) //Suppress qty 0
                                    facture.lines.push(aline);
                            }

                        facture.shipping.total_ht += client.data[i].shipping.total_ht;
                        facture.shipping.total_tva += client.data[i].shipping.total_tva;

                        deliveries_id.push(client.data[i]._id.toString());

                    }

                    facture.deliveries = _.uniq(deliveries_id, true);

                    facture.save(function(err, bill) {
                        if (err)
                            return console.log(err);

                        //console.log(bill);
                        for (var i = 0; i < bill.deliveries.length; i++) {
                            DeliveryModel.update({ _id: bill.deliveries[i] }, { $set: { Status: "BILLED" } }, function(err) {
                                if (err)
                                    console.log(err);
                            });
                        }
                        callback(err);
                    });
                });

            }, function(err) {
                if (err)
                    console.log(err);

                self.json({});

            });

        });
    },
    familyCA: function() {
        var result = [];
        var dateStart = new Date();
        dateStart.setHours(0, 0, 0, 0);
        dateStart.setMonth(0);
        dateStart.setDate(1);

        var family = ["MESSAGERIE", "AFFRETEMENT", "COURSE", "REGULIER"];
        async.parallel({
                cafamily: function(cb) {
                    var result = {};
                    //init CA

                    for (var i = 0; i < family.length; i++) {
                        result[family[i]] = [];
                        for (var m = 0; m < 12; m++)
                            result[family[i]].push(0);
                    }

                    /*
                     * Error $month operator with GMT !!!
                     * See https://jira.mongodb.org/browse/SERVER-6310
                     * 
                     * 
                     CoursesModel.aggregate([
                     {$match: {Status: {'$ne': 'REFUSED'}, date_enlevement: {'$gte': dateStart}}},
                     {$project: {total_ht: 1, type: 1, date_enlevement: 1}},
                     {$group: {
                     _id: {
                     type: "$type",
                     month: {$month: "$date_enlevement"}
                     },
                     total_ht: {$sum: "$total_ht"},
                     marge: {$sum: "$commission"}
                     }
                     }
                     ], function(err, docs) {
                     if (err)
                     console.log(err);
                     
                     console.log(docs);
                     
                     for (var i = 0; i < docs.length; i++) {
                     result[docs[i]._id.type][docs[i]._id.month - 1] = docs[i].total_ht;
                     }
                     
                     
                     console.log(result);
                     
                     cb(null, result);
                     });
                     */

                    CoursesModel.find({ Status: { '$ne': 'REFUSED' }, date_enlevement: { '$gte': dateStart } }, { total_ht: 1, type: 1, date_enlevement: 1 }, function(err, docs) {
                        if (err)
                            console.log(err);

                        //console.log(docs);

                        for (var i = 0; i < docs.length; i++) {

                            result[docs[i].type][docs[i].date_enlevement.getMonth()] += docs[i].total_ht;
                        }


                        //console.log(result);

                        cb(null, result);
                    });

                },
                caMonth: function(cb) {
                    var result = {};
                    result.total = [];
                    result.sum = [];
                    for (var m = 0; m < 12; m++)
                        result.total.push(0);

                    /*CoursesModel.aggregate([
                     {$match: {Status: {'$ne': 'REFUSED'}, date_enlevement: {'$gte': dateStart}}},
                     {$project: {total_ht: 1, date_enlevement: 1}},
                     {$group: {
                     _id: {
                     $month: "$date_enlevement"
                     },
                     total_ht: {$sum: "$total_ht"}}
                     }
                     ], function(err, docs) {*/
                    CoursesModel.find({ Status: { '$ne': 'REFUSED' }, date_enlevement: { '$gte': dateStart } }, { total_ht: 1, date_enlevement: 1 },
                        function(err, docs) {
                            for (var i = 0; i < docs.length; i++) {
                                result.total[docs[i].date_enlevement.getMonth()] += docs[i].total_ht;
                            }

                            //apply sum on ca
                            for (var i = 0; i < 12; i++)
                                if (i === 0)
                                    result.sum[i] = result.total[i];
                                else
                                    result.sum[i] = result.total[i] + result.sum[i - 1];

                            cb(null, result);
                        });
                },
                caCumul: function(cb) {
                    var result = [];
                    for (var m = 0; m < 12; m++)
                        result.push(0);

                    /*CoursesModel.aggregate([
                     {$match: {Status: {'$ne': 'REFUSED'}, date_enlevement: {'$gte': dateStart}}},
                     {$project: {total_ht: 1, date_enlevement: 1}},
                     {$group: {
                     _id: {
                     $month: "$date_enlevement"
                     },
                     total_ht: {$sum: "$total_ht"}
                     }
                     }*/
                    CoursesModel.find({ Status: { '$ne': 'REFUSED' }, date_enlevement: { '$gte': dateStart } }, { total_ht: 1, date_enlevement: 1 },
                        function(err, docs) {
                            for (var i = 0; i < docs.length; i++) {
                                result[docs[i].date_enlevement.getMonth()] += docs[i].total_ht;
                            }

                            cb(null, result);
                        });
                },
                caTotalfamily: function(cb) {
                    var result = [];

                    CoursesModel.aggregate([
                        { $match: { Status: { '$ne': 'REFUSED' }, date_enlevement: { '$gte': dateStart } } },
                        { $project: { total_ht: 1, type: 1, date_enlevement: 1 } }, {
                            $group: {
                                _id: "$type",
                                total_ht: { $sum: "$total_ht" }
                            }
                        }
                    ], function(err, docs) {
                        for (var i = 0; i < docs.length; i++) {
                            result.push({
                                name: docs[i]._id,
                                y: docs[i].total_ht
                            });
                        }

                        cb(null, result);
                    });
                }
            },
            function(err, results) {
                var result = [];
                if (err)
                    return console.log(err);

                for (var i in results.cafamily)
                    result.push({
                        type: 'column',
                        name: i,
                        data: results.cafamily[i]
                    });

                result.push({
                    type: 'spline',
                    name: 'CA mensuel N',
                    yAxis: 1,
                    data: results.caMonth.total,
                    marker: {
                        lineWidth: 2,
                        fillColor: '#4572A7'
                    }
                });

                /*result.push({
                 type: 'spline',
                 name: 'CA cumulé',
                 data: results.caMonth.sum,
                 marker: {
                 lineWidth: 2,
                 fillColor: 'white'
                 }
                 });*/

                result.push({
                    type: 'spline',
                    name: 'CA mensuel N-1',
                    yAxis: 1,
                    data: [226181, 219052, 225464, 126920, 207904, 223189, 246774, 213849, 221774, 239235, 215774, 235522],
                    marker: {
                        lineWidth: 2,
                        fillColor: '#4572A7'
                    }
                });

                result.push({
                    type: 'pie',
                    name: 'Total par famille',
                    data: results.caTotalfamily,
                    center: [80, 40],
                    size: 100,
                    showInLegend: false,
                    dataLabels: {
                        enabled: false
                    }
                });

                res.json(result);
                /*res.json(
                 [{
                 type: 'column',
                 name: 'Jane',
                 data: [3, 2, 1, 3, 4]
                 }, {
                 type: 'column',
                 name: 'John',
                 data: [2, 3, 5, 7, 6]
                 }, {
                 type: 'column',
                 name: 'Joe',
                 data: [4, 3, 3, 9, 0]
                 }, {
                 type: 'spline',
                 name: 'Average',
                 data: [3, 2.67, 3, 6.33, 3.33],
                 marker: {
                 lineWidth: 2,
                 fillColor: 'white'
                 }
                 }, {
                 type: 'pie',
                 name: 'Total family',
                 data: [{
                 name: 'Jane',
                 y: 13,
                 }, {
                 name: 'John',
                 y: 23,
                 }, {
                 name: 'Joe',
                 y: 19,
                 }],
                 center: [100, 40],
                 size: 100,
                 showInLegend: false,
                 dataLabels: {
                 enabled: false 			 }
                 }]
                 );*/
            });
    }
};

function createDelivery(doc, callback) {
    var SocieteModel = MODEL('societe').Schema;
    // Generation du BL PDF et download
    var fk_livraison;

    Dict.extrafield({ extrafieldName: 'BonLivraison' }, function(err, doc) {
        if (err) {
            console.log(err);
            return;
        }

        fk_livraison = doc;
    });

    var model = "_delivery.tex";

    SocieteModel.findOne({ _id: doc.client.id }, function(err, societe) {

        // Array of lines
        var tabLines = [];

        tabLines.push({
            keys: [
                { key: "ref", type: "string" },
                { key: "description", type: "area" },
                //{key: "qty_order", type: "number", precision: 3},
                { key: "qty", type: "number", precision: 3 }
            ]
        });

        for (var i = 0; i < doc.lines.length; i++) {
            if (doc.lines[i].product.name != 'SUBTOTAL' && doc.lines[i].qty !== 0)
                tabLines.push({
                    ref: doc.lines[i].product.name.substring(0, 12),
                    description: "\\textbf{" + doc.lines[i].product.label + "}" + (doc.lines[i].description ? "\\\\" + doc.lines[i].description : ""),
                    // qty_order: doc.lines[i].qty_order,
                    qty: { value: doc.lines[i].qty, unit: (doc.lines[i].product.unit ? " " + doc.lines[i].product.unit : "U") }
                });

            /*if (doc.lines[i].product.id.pack && doc.lines[i].product.id.pack.length) {
             for (var j = 0; j < doc.lines[i].product.id.pack.length; j++) {
             tabLines.push({
             ref: "*" + doc.lines[i].product.id.pack[j].id.ref.substring(0, 10),
             description: "\\textbf{" + doc.lines[i].product.id.pack[j].id.label + "}" + (doc.lines[i].product.id.pack[j].id.description ? "\\\\" + doc.lines[i].product.id.pack[j].id.description : ""),
             qty_order: doc.lines[i].qty_order * doc.lines[i].product.id.pack[j].qty,
             qty: {value: doc.lines[i].qty * doc.lines[i].product.id.pack[j].qty, unit: (doc.lines[i].product.id.pack[j].id.unit ? " " + doc.lines[i].product.id.pack[j].id.unit : "U")},
             italic: true
             });
             }
             }
             tabLines.push({hline: 1});*/


            //tab_latex += " & \\specialcell[t]{\\\\" + "\\\\} & " +   + " & " + " & " +  "\\tabularnewline\n";
        }

        // Array of totals
        var tabTotal = [{
            keys: [{
                    key: "label",
                    type: "string"
                }, {
                    key: "total",
                    type: "number",
                    precision: 3
                },
                {
                    key: "unit",
                    type: "string"
                }
            ]
        }];

        //Total HT
        tabTotal.push({
            label: "Quantité totale : ",
            total: _.sum(doc.lines, function(line) {
                return line.qty;
            }),
            unit: "pièce(s)"
        });

        // Poids
        if (doc.weight)
            tabTotal.push({
                label: "Poids total : ",
                total: doc.weight,
                unit: "kg"
            });

        Latex.Template(model, doc.entity)
            .apply({
                "NUM": { "type": "string", "value": doc.ref },
                "DESTINATAIRE.NAME": { "type": "string", "value": doc.name },
                "DESTINATAIRE.ADDRESS": { "type": "area", "value": doc.address },
                "DESTINATAIRE.ZIP": { "type": "string", "value": doc.zip },
                "DESTINATAIRE.TOWN": { "type": "string", "value": doc.town },
                "CODECLIENT": { "type": "string", "value": societe.code_client },
                //"TITLE": {"type": "string", "value": doc.title},
                "REFCLIENT": { "type": "string", "value": doc.ref_client },
                "DELIVERYMODE": { "type": "string", "value": doc.delivery_mode },
                "DATEC": {
                    "type": "date",
                    "value": doc.datec,
                    "format": CONFIG('dateformatShort')
                },
                "DATEEXP": {
                    "type": "date",
                    "value": doc.datedl,
                    "format": CONFIG('dateformatShort')
                },
                "ORDER": { "type": "string", "value": (doc.order && doc.order.ref ? doc.order.ref : "-") },
                "NOTES": {
                    "type": "area",
                    "value": (doc.notes.length ? doc.notes[0].note : "")
                },
                "TABULAR": tabLines,
                "TOTALQTY": tabTotal
            })
            .on('error', callback)
            .finalize(function(tex) {
                //console.log('The document was converted.');
                callback(null, tex);
            });
    });
}

function createDelivery2(doc, callback) {
    var SocieteModel = MODEL('societe').Schema;
    var BankModel = MODEL('bank').Schema;
    // Generation des BL chiffre PDF et download

    var discount = false;
    var cond_reglement_code = {};
    Dict.dict({ dictName: "fk_payment_term", object: true }, function(err, docs) {
        cond_reglement_code = docs;
    });
    var mode_reglement_code = {};
    Dict.dict({ dictName: "fk_paiement", object: true }, function(err, docs) {
        mode_reglement_code = docs;
    });

    var model = "PRICE";

    if (CONFIG('delivery.type') == "NOPRICE")
        model = "NOPRICE";
    else
    // check if discount
        for (var i = 0; i < doc.lines.length; i++) {
        if (doc.lines[i].discount > 0) {
            model = "DISCOUNT";
            break;
        }
    }

    SocieteModel.findOne({ _id: doc.client.id }, function(err, societe) {
        BankModel.findOne({ ref: societe.bank_reglement }, function(err, bank) {
            if (bank)
                var iban = bank.name_bank + "\n RIB : " + bank.code_bank + " " + bank.code_counter + " " + bank.account_number + " " + bank.rib + "\n IBAN : " + bank.iban + "\n BIC : " + bank.bic;

            // Array of lines
            var tabLines = [];

            switch (model) {
                case "DISCOUNT":
                    tabLines.push({
                        keys: [
                            { key: "ref", type: "string" },
                            { key: "description", type: "area" },
                            { key: "tva_tx", type: "string" },
                            { key: "pu_ht", type: "number", precision: 3 },
                            { key: "discount", type: "string" },
                            { key: "qty", type: "number", precision: 3 },
                            { key: "total_ht", type: "euro" }
                        ]
                    });
                    break;
                case "NOPRICE":
                    tabLines.push({
                        keys: [
                            { key: "ref", type: "string" },
                            { key: "description", type: "area" },
                            //{key: "tva_tx", type: "string"},
                            //{key: "pu_ht", type: "number", precision: 3},
                            { key: "qty", type: "number", precision: 3 },
                            //{key: "total_ht", type: "euro"}
                        ]
                    });
                    break;
                default: //PRICE
                    tabLines.push({
                        keys: [
                            { key: "ref", type: "string" },
                            { key: "description", type: "area" },
                            { key: "tva_tx", type: "string" },
                            { key: "pu_ht", type: "number", precision: 3 },
                            { key: "qty", type: "number", precision: 3 },
                            { key: "total_ht", type: "euro" }
                        ]
                    });
            }

            for (var i = 0; i < doc.lines.length; i++) {
                if (doc.lines[i].product.name != 'SUBTOTAL' && doc.lines[i].qty !== 0)
                    tabLines.push({
                        ref: (doc.lines[i].product.name != 'SUBTOTAL' ? doc.lines[i].product.name.substring(0, 12) : ""),
                        description: "\\textbf{" + doc.lines[i].product.label + "}\\\\" + doc.lines[i].description,
                        tva_tx: doc.lines[i].tva_tx,
                        pu_ht: doc.lines[i].pu_ht,
                        discount: (doc.lines[i].discount ? (doc.lines[i].discount + " %") : ""),
                        qty: doc.lines[i].qty,
                        total_ht: doc.lines[i].total_ht
                    });

                if (doc.lines[i].product.name == 'SUBTOTAL') {
                    tabLines[tabLines.length - 1].italic = true;
                    tabLines.push({ hline: 1 });
                }
                //tab_latex += " & \\specialcell[t]{\\\\" + "\\\\} & " +   + " & " + " & " +  "\\tabularnewline\n";
            }

            // Array of totals
            var tabTotal = [{
                keys: [
                    { key: "label", type: "string" },
                    { key: "total", type: "euro" }
                ]
            }];

            // Frais de port 
            if (doc.shipping && doc.shipping.total_ht)
                tabTotal.push({
                    label: "Frais de port",
                    total: doc.shipping.total_ht
                });

            //Total HT
            tabTotal.push({
                label: "Total HT",
                total: doc.total_ht
            });

            for (var i = 0; i < doc.total_tva.length; i++) {
                tabTotal.push({
                    label: "Total TVA " + doc.total_tva[i].tva_tx + " %",
                    total: doc.total_tva[i].total
                });
            }

            //Total TTC
            tabTotal.push({
                label: "Total TTC",
                total: doc.total_ttc
            });

            // Array of totals Qty
            var tabTotalQty = [{
                keys: [{
                        key: "label",
                        type: "string"
                    }, {
                        key: "total",
                        type: "number",
                        precision: 3
                    },
                    {
                        key: "unit",
                        type: "string"
                    }
                ]
            }];

            tabTotalQty.push({
                label: "Quantité totale : ",
                total: _.sum(doc.lines, function(line) {
                    return line.qty;
                }),
                unit: "pièce(s)"
            });

            // Poids
            if (doc.weight)
                tabTotalQty.push({
                    label: "Poids total : ",
                    total: doc.weight,
                    unit: "kg"
                });


            var reglement = "";
            switch (doc.mode_reglement_code) {
                case "VIR":
                    if (societe.bank_reglement) { // Bank specific for payment
                        reglement = "\n" + iban;
                    } else // Default IBAN
                        reglement = "\n --IBAN--";
                    break;
                case "CHQ":
                    reglement = "A l'ordre de --ENTITY--";
                    break;
            }

            /*tab_latex += "Total HT &" + latex.price(doc.total_ht) + "\\tabularnewline\n";
             for (var i = 0; i < doc.total_tva.length; i++) {
             tab_latex += "Total TVA " + doc.total_tva[i].tva_tx + "\\% &" + latex.price(doc.total_tva[i].total) + "\\tabularnewline\n";
             }
             tab_latex += "\\vhline\n";
             tab_latex += "Total TTC &" + latex.price(doc.total_ttc) + "\\tabularnewline\n";*/

            //Periode de facturation
            var period = "";
            if (doc.dateOf && doc.dateTo)
                period = "\\textit{P\\'eriode du " + moment(doc.dateOf).format(CONFIG('dateformatShort')) + " au " + moment(doc.dateTo).format(CONFIG('dateformatShort')) + "}\\\\";

            var model_latex = "_delivery2.tex"; //PRICE

            if (model === "DISCOUNT")
                model_latex = "_delivery2_discount.tex";
            else if (model === "NOPRICE")
                model_latex = "_delivery.tex";

            Latex.Template(model_latex, doc.entity)
                .apply({
                    "TITLE": { "type": "string", "value": "Bon de livraison" },
                    "NUM": { "type": "string", "value": doc.ref },
                    "DESTINATAIRE.NAME": { "type": "string", "value": doc.name },
                    "DESTINATAIRE.ADDRESS": { "type": "area", "value": doc.address },
                    "DESTINATAIRE.ZIP": { "type": "string", "value": doc.zip },
                    "DESTINATAIRE.TOWN": { "type": "string", "value": doc.town },
                    //"DESTINATAIRE.TVA": {"type": "string", "value": societe.idprof6},
                    "CODECLIENT": { "type": "string", "value": societe.code_client },
                    //"TITLE": {"type": "string", "value": doc.title},
                    "REFCLIENT": { "type": "string", "value": doc.ref_client },
                    "PERIOD": { "type": "string", "value": period },
                    "DELIVERYMODE": { "type": "string", "value": doc.delivery_mode },
                    "DATEEXP": {
                        "type": "date",
                        "value": doc.datedl,
                        "format": CONFIG('dateformatShort')
                    },
                    "DATEC": {
                        "type": "date",
                        "value": doc.datec,
                        "format": CONFIG('dateformatShort')
                    },
                    "REGLEMENT": { "type": "string", "value": cond_reglement_code.values[doc.cond_reglement_code].label },
                    "PAID": { "type": "string", "value": mode_reglement_code.values[doc.mode_reglement_code].label },
                    "ORDER": { "type": "string", "value": (doc.order && doc.order.ref ? doc.order.ref : "-") },
                    "NOTES": {
                        "type": "string",
                        "value": (doc.notes.length ? doc.notes[0].note : "")
                    },
                    "BK": { "type": "area", "value": reglement },
                    "TABULAR": tabLines,
                    //"TOTAL": tabTotal,
                    "TOTALQTY": tabTotalQty
                        //"APAYER": {
                        //    "type": "euro",
                        //    "value": doc.total_ttc || 0
                        //}
                })
                .on('error', callback)
                .finalize(function(tex) {
                    //console.log('The document was converted.');
                    callback(null, tex);
                });
        });
    });
}