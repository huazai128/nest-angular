import { Length, IsEmail, IsOptional, IsString, IsEnum, ValidateNested } from 'class-validator';
import { Entity } from './Entity';
export enum App {
    admin = 'admin',
    mf='mf',
    macro='macro',
}

export enum Permission {
    admin,
    user,
}

export class Role {
    @IsEnum(App)
    app: App;
    @IsEnum(Permission)
    permission: Permission;
    constructor(role: Role) {
        Object.assign(this, role);
    }
}

export class User extends Entity {
    @IsOptional() @IsString()  @Length(5, 10)  password: string;
    @IsString() company: string;
    @IsString() phone: string;
    @IsEmail() email: string;
    @IsOptional() @IsString() details?: string;
    @IsOptional() @IsString() fName?: string;
    @IsOptional() @IsString() lName?: string;
    get fullName() {
        return this.fName + ' ' + this.lName;
    }
    @ValidateNested({ each: true }) roles: Role[];
    constructor(user: Partial<User>) {
        super(user);
        if (user && user.roles) {
            this.roles = user.roles.map(role => new Role(role));
        }
    }
}

export class LoginRequest {
    @IsString()
    @IsEmail()
    email: string;

    @IsString()
    @Length(5, 10)
    password: string;
    constructor(login?: Partial<LoginRequest>) {
        Object.assign(this, login);
    }
}

// export class o {
//     email: string;
//     num: number;
// }

// enum Color { Red, Green, Blue }
// export class LoginRequest {
//     email: string;
//     num: number;
//     numArray:number[];
//     color: Color;
//     bool: boolean;
//     data: Date;
//     obj:o;
//     objArr:o[]
//     optional?:string;
// }
