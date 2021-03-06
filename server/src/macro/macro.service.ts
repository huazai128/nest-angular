import * as sql from 'mssql';
import { Injectable } from '@nestjs/common';
import { macroConf } from '../../../../config';
import { Logger } from '@nestjs/common';
import { Category, Series, Data, DataRequest, DataItem, UserSettings } from 'shared/models/macro.model';
import { Repository, RepositoryFactory } from 'mongo-nest';
import { pathBySelector } from 'shared/utils';
import { categoriesQuery } from './queries';
import { chunk } from 'lodash';
@Injectable()
export class MacroService {
    private readonly logger = new Logger('DataService');
    private categoryRepo: Repository<Category>;
    private seriesRepo: Repository<Series>;
    private dataRepo: Repository<Data>;
    private userSettingsRepo: Repository<UserSettings>;
    constructor(private repositoryFactory: RepositoryFactory) {
        this.categoryRepo = this.repositoryFactory.getRepository<Category>(Category, 'DBMacro');
        this.seriesRepo = this.repositoryFactory.getRepository<Series>(Series, 'DBMacro');
        this.dataRepo = this.repositoryFactory.getRepository<Data>(Data, 'DBMacro');
        this.userSettingsRepo = this.repositoryFactory.getRepository<UserSettings>(UserSettings, 'DBMacro');
    }

    async update() {
        await Promise.all([this.updateData(), this.updateCategoriesAndSeries()]);
    }

    private async updateData() {
        return new Promise(async (resolve, reject) => {
            await this.dataRepo.collection.deleteMany({});
            const pool = new sql.ConnectionPool(macroConf.db);
            pool.on('error', err => {
                this.logger.error('sql errors', err);
            });
            try {
                await pool.connect();
                const ids = (await pool
                    .request()
                    .query('select distinct pasp_id as id from [dbMacro].[dbo].[prData]')).recordset.map(row => row.id);
                // const chunks = chunk<string>(ids, 100);
                //for (const c of chunks) {
                // const query = `
                // SELECT pasp_id as id, report_date  as d, data_value as v
                // FROM [dbMacro].[dbo].[prData]
                // WHERE pasp_id in ('${c.join("','")}')
                // `;

                // const dbData = (await pool.request().query(query)).recordset;
                // const toSave: Data[] = [];
                // for (const id of c) {
                //     const data = dbData.filter(d => d.id === id).map(d => ({ timeStamp: +d.d, value: d.v }));
                //     toSave.push({ _id: id, data } as Data);
                // }
                // await this.dataRepo.saveOrUpdateMany(toSave);

                await Promise.all(
                    ids.map(async id => {
                        const query = `
                            SELECT pasp_id as id, report_date  as d, data_value as v
                            FROM [dbMacro].[dbo].[prData]
                            WHERE pasp_id = '${id}'
                            `;
                        const dbData = (await pool.request().query(query)).recordset;
                        const data: Array<{ timeStamp: number; value: number }> = [];
                        dbData.forEach(d => {
                            data.push({ timeStamp: +d.d, value: d.v });
                        });
                        this.dataRepo.saveOrUpdateOne({ _id: id, data });
                        //  this.logger.log(id);
                    }),
                );
                // this.logger.log('1');
                // }
                this.logger.log('finish data');
                resolve(true);
            } catch (err) {
                reject(err);
                this.logger.error(err);
            } finally {
                pool.close();
            }
        });
    }
    private async updateCategoriesAndSeries() {
        const getChildren = (categories, category) => {
            const children = categories.filter(
                c => c._id.length === category._id.length + 1 && c._id.slice(0, category._id.length) === category._id,
            );
            if (!children.length) {
                return undefined;
            }
            children.forEach(child => (child.children = getChildren(categories, child)));
            return children;
        };

        return new Promise(async (resolve, reject) => {
            const pool = new sql.ConnectionPool(macroConf.db);
            try {
                await pool.connect();
                const categoriesDB: Category[] = (await pool.request().query(categoriesQuery)).recordset;
                const categories = [...categoriesDB.filter(category => category._id.length === 1)];

                categories.forEach(category => {
                    category.children = getChildren(categoriesDB, category);
                });
                await this.categoryRepo.collection.deleteMany({});
                await this.categoryRepo.saveOrUpdateMany(categories);

                const series: Series[] = (await pool.request().query(`
                SELECT prPasp.pasp_id AS _id,
                prPasp.name_hebrew AS name,
                prType.name_hebrew AS hebTypeName,
                prPasp.first_trading_date AS startDate,
                prPasp.last_trading_date AS endDate,
                tblUnit.UNIT_NAME AS unitEnName,
                prPasp.date_update as lastUpdate,
                tblSource.SOURCE_NAME AS Source
                FROM prPasp LEFT OUTER JOIN prType ON prPasp.type_id = prType.type_id 
				LEFT OUTER JOIN tblSource ON prPasp.source_id = tblSource.SOURCE_ID 
                LEFT OUTER JOIN tblUnit ON prPasp.unit_id = tblUnit.UNIT_ID
	            where left(pasp_id,3) = (SELECT catg_id FROM prCatg WHERE catg_id = left(pasp_id,3))
            `)).recordset;
                series.forEach(s => {
                    s.catalogPath = '';
                    s.endDate = +s.endDate;
                    s.startDate = +s.startDate;
                    s.lastUpdate = +s.lastUpdate;
                    for (let i = 1; i <= 3; i++) {
                        const subId = s._id.slice(0, i);
                        s.catalogPath += categoriesDB.find(c => c._id === subId).name;

                        if (i !== 3) {
                            s.catalogPath += ' | ';
                        }
                    }
                });
                await this.seriesRepo.collection.deleteMany({});
                await this.seriesRepo.saveOrUpdateMany(series);

                resolve(true);
            } catch (err) {
                reject(err);
                this.logger.error(err);
            } finally {
                pool.close();
            }
        });
    }

    async getCategories() {
        return this.categoryRepo.findMany();
    }

    async getSeries() {
        return this.seriesRepo.findMany();
    }

    async getData(req: DataRequest): Promise<Data[]> {
        const path = '$$' + pathBySelector((item: DataItem) => item.timeStamp);
        return this.dataRepo.collection
            .aggregate([
                { $match: { _id: { $in: req.seriesIds } } },
                {
                    $project: {
                        data: {
                            $filter: {
                                input: '$data',
                                as: 'item',
                                cond: {
                                    $and: [{ $gte: [path, req.from] }, { $lte: [path, req.to] }],
                                },
                            },
                        },
                    },
                },
            ])
            .toArray() as Promise<Data[]>;
    }

    async getUserSettings(id: string): Promise<UserSettings> {
        return (
            (await this.userSettingsRepo.findOne({ _id: id })) ||
            new UserSettings({ _id: id, userTemplates: [{ seriesIds: [], name: 'טמפלט', _id: '0' }] })
        );
    }

    async saveUserSettings(userSettings: UserSettings) {
        return this.userSettingsRepo.saveOrUpdateOne(userSettings);
    }
}
