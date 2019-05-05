import { Injectable, ForbiddenException } from '@nestjs/common';
import { User, AddUserDTO, App, hasPermission } from 'shared';
import { Repository, RepositoryFactory } from 'mongo-nest';
import { genSalt, hash, compare } from 'bcrypt';
import * as NodeCache from 'node-cache';
import { randomBytes } from 'crypto';

const generateToken = (): Promise<string> =>
  new Promise(resolve =>
    randomBytes(48, (err, buffer) => resolve(buffer.toString('hex'))),
  );

const cryptPassword = async password => {
  const salt = await genSalt(10);
  return hash(password, salt);
};

const comparePassword = (plainPass, hashword) => {
  return compare(plainPass, hashword);
};

@Injectable()
export class UserService {
  userRepo: Repository<User>;
  // remove object after 10 minute
  private chache = new NodeCache({ stdTTL: 60 * 10 });

  constructor(private repositoryFactory: RepositoryFactory) {
    this.userRepo = this.repositoryFactory.getRepository<User>(User, 'users');
    this.saveUser({
      _id: 'admin@admin.com',
      fName: 'yoyo',
      lName: 'toto',
      roles: [{ app: App.admin }],
      password: '123456',
    } as AddUserDTO);
  }

  async validateUser(email, password) {
    const user = (await this.userRepo.collection.findOne({
      _id: email,
    })) as AddUserDTO;
    if (!user || !(await comparePassword(password, user.password))) {
      throw new Error('somthing wrong');
    }
    delete user.password;
    // TODO use token instead id.
    setTimeout(() => this.chache.set(user._id, user));
    return user;
  }

  async saveUser(user: AddUserDTO) {
    user.password = await cryptPassword(user.password);
    this.userRepo.saveOrUpdateOne(user);
  }
  async getUserAuthenticated(id): Promise<User> {
    if (!id) {
      return undefined;
    }
    let foundUser = this.chache.get<User>(id);
    if (!foundUser) {
      return undefined;
    }

    if (!foundUser) {
      foundUser = await this.userRepo.findOne({ _id: id });
    }
    setTimeout(() => this.chache.set(foundUser._id, foundUser));
    return foundUser;
  }

  async isAuthorized(id, app: App) {
    const user = await this.getUserAuthenticated(id);
    return hasPermission(user, app);
  }
}
