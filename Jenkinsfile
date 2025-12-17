pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                // Pull code from Git
                git branch: 'main', url: 'https://github.com/johnroshan2255/docker-web-terminal.git'
            }
        }

        stage('Install Dependencies') {
            steps {
                // Install Node modules
                sh 'npm install'
            }
        }

        stage('Build Svelte Project') {
            steps {
                // Run the dev or build command
                sh 'npm run build'
            }
        }
    }

    post {
        success {
            echo 'Build succeeded!'
        }
        failure {
            echo 'Build failed!'
        }
    }
}
